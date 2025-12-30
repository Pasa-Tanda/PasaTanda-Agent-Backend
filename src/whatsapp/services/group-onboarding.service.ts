import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair } from '@stellar/stellar-sdk';
import { randomUUID } from 'crypto';
import { SupabaseService } from './supabase.service';
import { SorobanClientService } from './soroban-client.service';
import { GroupService } from './group.service';
import { EncryptionService } from './encryption.service';
import { WhatsappService } from '../whatsapp.service';
import { PaymentIntegrationService } from './payment-integration.service';
import { VerificationService } from './verification.service';

export interface OnboardingRequest {
  phoneNumber: string;
  username: string;
  groupName: string;
  amountBs: number;
  amountUsdc: number;
  exchangeRate: number;
  frequencyDays: number;
  yieldEnabled: boolean;
  verificationCode?: string;
}

export interface OnboardingResult {
  groupId: number;
  groupWhatsappId?: string;
  contractAddress?: string;
  paymentOrderId?: string;
  paymentJobId?: string;
  payUrl?: string;
  qrIpfs?: string;
  status?: string;
}

@Injectable()
export class GroupOnboardingService {
  private readonly logger = new Logger(GroupOnboardingService.name);
  private readonly mainPageUrl: string;
  private readonly phoneNumberId: string;
  private readonly payToFallback: string;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly soroban: SorobanClientService,
    private readonly groupService: GroupService,
    private readonly encryption: EncryptionService,
    private readonly whatsapp: WhatsappService,
    private readonly payments: PaymentIntegrationService,
    private readonly verification: VerificationService,
    config: ConfigService,
  ) {
    this.mainPageUrl = config.get<string>('MAIN_PAGE_URL', '').replace(/\/$/, '');
    this.phoneNumberId = config.get<string>('WHATSAPP_PHONE_NUMBER_ID', '');
    this.payToFallback = config.get<string>('X402_PAY_TO_ADDRESS', '');
  }

  async start(request: OnboardingRequest): Promise<OnboardingResult> {
    const isVerified = await this.verification.isVerified(request.phoneNumber);
    if (!isVerified) {
      throw new Error('Teléfono no verificado. Pide el código con /api/onboarding/verify y envíalo por WhatsApp.');
    }

    const user = await this.ensureUser(request.phoneNumber, request.username);
    const whatsappGroup = await this.groupService.createGroup(this.phoneNumberId, {
      subject: request.groupName,
      participants: [request.phoneNumber],
    });

    const groupRow = await this.supabase.query<{ id: number }>(
      `INSERT INTO groups (group_whatsapp_id, name, contract_address, total_cycle_amount_usdc, frequency_days, yield_enabled, status)
       VALUES ($1, $2, NULL, $3, $4, $5, 'DRAFT') RETURNING id` as string,
      [whatsappGroup.id ?? null, request.groupName, request.amountUsdc, request.frequencyDays, request.yieldEnabled],
    );
    const groupId = groupRow[0]?.id;
    if (!groupId) {
      throw new Error('No se pudo persistir el grupo en Supabase');
    }

    await this.supabase.query(
      `INSERT INTO memberships (user_id, group_id, turn_number, is_admin) VALUES ($1, $2, $3, true)
       ON CONFLICT DO NOTHING` as string,
      [user.id, groupId, 1],
    );

    await this.supabase.query(
      `INSERT INTO payment_orders (id, user_id, group_id, amount_fiat, currency_fiat, amount_crypto_usdc, payment_method, status)
       VALUES ($1, $2, $3, $4, 'BOB', $5, 'QR_SIMPLE', 'DRAFT')` as string,
      [randomUUID(), user.id, groupId, request.amountBs, request.amountUsdc],
    );

    return {
      groupId,
      groupWhatsappId: whatsappGroup.id ?? undefined,
      contractAddress: undefined,
      paymentOrderId: undefined,
      paymentJobId: undefined,
      payUrl: undefined,
      qrIpfs: undefined,
      status: 'DRAFT',
    };
  }

  async startTanda(params: {
    groupId: number;
    amountBs: number;
    amountUsdc: number;
    exchangeRate?: number;
    frequencyDays?: number;
    yieldEnabled?: boolean;
  }): Promise<OnboardingResult> {
    const rows = await this.supabase.query<{
      id: number;
      name: string;
      group_whatsapp_id: string | null;
      contract_address: string | null;
      frequency_days: number | null;
      yield_enabled: boolean | null;
      status: string;
      user_id: number;
      phone_number: string;
      stellar_public_key: string;
    }>(
      `SELECT g.id, g.name, g.group_whatsapp_id, g.contract_address, g.frequency_days, g.yield_enabled, g.status,
              u.id as user_id, u.phone_number, u.stellar_public_key
       FROM groups g
       JOIN memberships m ON m.group_id = g.id AND m.is_admin = true
       JOIN users u ON u.id = m.user_id
       WHERE g.id = $1
       LIMIT 1` as string,
      [params.groupId],
    );

    const group = rows[0];
    if (!group) {
      throw new Error('Grupo no encontrado');
    }

    if (group.contract_address) {
      return {
        groupId: group.id,
        groupWhatsappId: group.group_whatsapp_id ?? undefined,
        contractAddress: group.contract_address,
        status: group.status,
      };
    }

    const amountPerRoundStroops = this.toStroops(params.amountUsdc);
    const sorobanGroup = await this.soroban.createGroup({
      admin: group.stellar_public_key,
      amountStroops: amountPerRoundStroops,
      frequencyDays: params.frequencyDays ?? group.frequency_days ?? 30,
      members: [group.stellar_public_key],
      yieldEnabled: params.yieldEnabled ?? group.yield_enabled ?? true,
    });

    if (!sorobanGroup.address) {
      throw new Error('No se pudo desplegar el contrato del grupo');
    }

    await this.supabase.query(
      `UPDATE groups SET contract_address = $1, status = 'ACTIVE' WHERE id = $2` as string,
      [sorobanGroup.address, group.id],
    );

    const paymentOrderId = randomUUID();
    await this.supabase.query(
      `INSERT INTO payment_orders (id, user_id, group_id, amount_fiat, currency_fiat, amount_crypto_usdc, payment_method, status)
       VALUES ($1, $2, $3, $4, 'BOB', $5, 'QR_SIMPLE', 'PENDING')` as string,
      [paymentOrderId, group.user_id, group.id, params.amountBs, params.amountUsdc],
    );

    const negotiation = await this.payments.negotiatePayment({
      orderId: paymentOrderId,
      amountUsd: params.amountUsdc,
      payTo: sorobanGroup.address ?? this.payToFallback || undefined,
      details: `Pago ${group.name}`,
    });

    await this.supabase.query(
      `UPDATE payment_orders SET xdr_challenge = $1, qr_payload_url = $2, status = 'CLAIMED_BY_USER', proof_metadata = $3 WHERE id = $4` as string,
      [
        negotiation.challenge ?? null,
        negotiation.qrBase64 ?? null,
        negotiation.jobId ? JSON.stringify({ x402JobId: negotiation.jobId }) : null,
        paymentOrderId,
      ],
    );

    const payUrl = this.mainPageUrl ? `${this.mainPageUrl}/pagos/${paymentOrderId}` : undefined;

    const monthName = this.resolveMonthName();
    const templateComponents = [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: monthName },
          { type: 'text', text: `Bs ${params.amountBs?.toFixed(2) ?? '0.00'}` },
          { type: 'text', text: params.exchangeRate?.toFixed(2) ?? '0.00' },
          { type: 'text', text: group.name },
        ],
      },
    ];

    await this.whatsapp.sendTemplateMessage(
      group.phone_number,
      'payment_request',
      'es',
      templateComponents,
      {},
    );

    const bodyText = `Paga Bs ${params.amountBs?.toFixed(2) ?? '0.00'} para tu grupo ${group.name}.`;
    if (negotiation.qrBase64) {
      await this.whatsapp.sendInteractiveCtaUrlWithQr(
        group.phone_number,
        {
          qrBase64: negotiation.qrBase64,
          bodyText,
          footerText: 'Confirma aqui cuando pagues.',
          buttonDisplayText: 'Pagar ahora',
          buttonUrl: payUrl ?? this.mainPageUrl ?? '',
        },
        {},
      );
    } else if (payUrl) {
      await this.whatsapp.sendInteractiveCtaUrl(
        group.phone_number,
        {
          bodyText,
          footerText: 'Link seguro de pago',
          buttonDisplayText: 'Abrir pago',
          buttonUrl: payUrl,
        },
        {},
      );
    }

    return {
      groupId: group.id,
      groupWhatsappId: group.group_whatsapp_id ?? undefined,
      contractAddress: sorobanGroup.address,
      paymentOrderId,
      paymentJobId: negotiation.jobId,
      payUrl,
      qrIpfs: negotiation.qrBase64,
      status: 'ACTIVE',
    };
  }

  private async ensureUser(phoneNumber: string, username: string): Promise<{ id: number; stellar_public_key: string }> {
    const existing = await this.supabase.query<{ id: number; stellar_public_key: string }>(
      'SELECT id, stellar_public_key FROM users WHERE phone_number = $1 LIMIT 1',
      [phoneNumber],
    );
    if (existing.length) {
      return existing[0];
    }

    const keypair = Keypair.random();
    const encrypted = this.encryption.encrypt({ secret: keypair.secret() });

    const inserted = await this.supabase.query<{ id: number; stellar_public_key: string }>(
      `INSERT INTO users (phone_number, username, stellar_public_key, wallet_type, wallet_secret_enc, preferred_currency)
       VALUES ($1, $2, $3, 'GENERATED', $4, 'BOB') RETURNING id, stellar_public_key` as string,
      [phoneNumber, username, keypair.publicKey(), JSON.stringify(encrypted)],
    );

    return inserted[0];
  }

  private toStroops(amountUsdc: number): string {
    const stroops = Math.max(0, Math.round(amountUsdc * 10_000_000));
    return String(stroops);
  }

  private resolveMonthName(): string {
    const monthNames = [
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre',
    ];
    const now = new Date();
    return monthNames[now.getUTCMonth()] ?? 'Mes';
  }
}
