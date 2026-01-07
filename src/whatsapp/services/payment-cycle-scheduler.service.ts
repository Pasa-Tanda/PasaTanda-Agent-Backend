import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { SupabaseService } from './supabase.service';
import { PaymentIntegrationService } from './payment-integration.service';
import {
  WhatsAppMessagingService,
  type WhatsAppInteractiveButton,
} from './whatsapp-messaging.service';

@Injectable()
export class PaymentCycleSchedulerService {
  private readonly logger = new Logger(PaymentCycleSchedulerService.name);
  private readonly enabled: boolean;
  private readonly phoneNumberId: string;
  private readonly paymentPage: string;
  private readonly paymentHeaderImageUrl: string;
  private readonly paymentRequestStickerUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
    private readonly payments: PaymentIntegrationService,
    private readonly messaging: WhatsAppMessagingService,
  ) {
    this.enabled =
      String(this.config.get<string>('PAYMENT_CYCLE_CRON_ENABLED', 'false'))
        .trim()
        .toLowerCase() === 'true';
    this.phoneNumberId =
      this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID', '') ||
      this.config.get<string>('PHONE_NUMBER_ID', '');
    this.paymentPage = this.config.get<string>('MAIN_PAGE_URL', '');
    this.paymentHeaderImageUrl = this.config.get<string>(
      'WHATSAPP_IMAGE_PAYMENT',
      '',
    );
    this.paymentRequestStickerUrl = this.config.get<string>(
      'WHATSAPP_STICKER_PAYMENT_REQUEST',
      '',
    );
  }

  // Cada 10 minutos: intenta iniciar ciclos vencidos.
  @Cron(CronExpression.EVERY_10_MINUTES)
  async tick(): Promise<void> {
    if (!this.enabled) return;
    if (!this.supabase.isEnabled()) {
      this.logger.warn('Supabase deshabilitado; se omite cron de pagos');
      return;
    }

    try {
      const groups = await this.supabase.query<{
        id: number;
        name: string;
        status: string;
        contract_address: string | null;
        frequency_days: number | null;
        total_cycle_amount_usdc: number | null;
      }>(
        `select id, name, status, contract_address, frequency_days, total_cycle_amount_usdc
         from groups
         where status = 'ACTIVE'
           and contract_address is not null
           and frequency_days is not null
           and frequency_days > 0
          and total_cycle_amount_usdc is not null
         order by id desc
         limit 50`,
      );

      for (const group of groups) {
        await this.processGroup(group);
      }
    } catch (error) {
      this.logger.error(`Cron pagos falló: ${(error as Error).message}`);
    }
  }

  private async processGroup(group: {
    id: number;
    name: string;
    contract_address: string | null;
    frequency_days: number | null;
    total_cycle_amount_usdc: number | null;
  }): Promise<void> {
    const frequencyDays = group.frequency_days ?? 0;
    const amountUsd = Number(group.total_cycle_amount_usdc ?? 0);
    const contractAddress = group.contract_address;
    if (!contractAddress || !frequencyDays || !amountUsd) return;

    const members = await this.supabase.query<{
      user_id: number;
      phone_number: string;
      turn_number: number;
    }>(
      `select m.user_id, u.phone_number, m.turn_number
       from memberships m
       join users u on u.id = m.user_id
       where m.group_id = $1
       order by m.turn_number asc`,
      [group.id],
    );

    if (members.length < 2) return;

    const lastCycle = await this.supabase.query<{
      cycle_index: number;
      last_created_at: string;
    }>(
      `select (proof_metadata->>'cycle_index')::int as cycle_index,
              max(created_at) as last_created_at
       from payment_orders
       where group_id = $1
         and proof_metadata ? 'cycle_index'
       group by cycle_index
       order by cycle_index desc
       limit 1`,
      [group.id],
    );

    const lastCycleIndex = lastCycle[0]?.cycle_index;
    const lastCreatedAt = lastCycle[0]?.last_created_at
      ? Date.parse(lastCycle[0].last_created_at)
      : NaN;

    const now = Date.now();
    const dueMs = frequencyDays * 24 * 60 * 60 * 1000;
    const isDue =
      lastCycleIndex === undefined ||
      Number.isNaN(lastCreatedAt) ||
      now - lastCreatedAt >= dueMs;

    if (!isDue) return;

    const nextCycleIndex = (lastCycleIndex ?? -1) + 1;
    const winnerTurnNumber = (nextCycleIndex % members.length) + 1;
    const winner =
      members.find((m) => m.turn_number === winnerTurnNumber) ?? members[0];

    const winnerPhone = this.normalizePhone(winner.phone_number);
    await this.notifyWinner(group, winnerPhone, nextCycleIndex);

    for (const member of members) {
      if (member.user_id === winner.user_id) continue;
      await this.createAndSendPaymentRequest({
        group: {
          id: group.id,
          name: group.name,
          contract_address: contractAddress,
        },
        payer: member,
        winnerPhone,
        cycleIndex: nextCycleIndex,
        amountUsd,
      });
    }

    this.logger.log(
      `Ciclo iniciado: group=${group.id} cycle=${nextCycleIndex} winnerTurn=${winnerTurnNumber}`,
    );
  }

  private async notifyWinner(
    group: { id: number; name: string },
    winnerPhone: string,
    cycleIndex: number,
  ): Promise<void> {
    const buttons: WhatsAppInteractiveButton[] = [
      {
        type: 'reply',
        reply: {
          id: `payout:fiat:${group.id}:${cycleIndex}`,
          title: 'Retirar a banco',
        },
      },
      {
        type: 'reply',
        reply: {
          id: `payout:usdc:${group.id}:${cycleIndex}`,
          title: 'Retirar USDC',
        },
      },
      {
        type: 'reply',
        reply: {
          id: `payout:later:${group.id}:${cycleIndex}`,
          title: 'Luego',
        },
      },
    ];

    await this.messaging.sendInteractiveButtons(
      winnerPhone,
      `🎉 ¡Es tu turno en "${group.name}"!\n\n¿Cómo quieres retirar?`,
      buttons,
      {
        phoneNumberId: this.phoneNumberId,
        header: this.paymentHeaderImageUrl
          ? { type: 'image', image: { link: this.paymentHeaderImageUrl } }
          : undefined,
        footer: `Ciclo #${cycleIndex + 1}`.slice(0, 60),
      },
    );
  }

  private async createAndSendPaymentRequest(params: {
    group: {
      id: number;
      name: string;
      contract_address: string;
    };
    payer: { user_id: number; phone_number: string; turn_number: number };
    winnerPhone: string;
    cycleIndex: number;
    amountUsd: number;
  }): Promise<void> {
    const orderId = randomUUID();
    const payerPhone = this.normalizePhone(params.payer.phone_number);

    const metadata = {
      kind: 'TANDA_QUOTA',
      cycle_index: params.cycleIndex,
      group_id: params.group.id,
      group_name: params.group.name,
      payer_phone: payerPhone,
      winner_phone: params.winnerPhone,
    };

    await this.supabase.query(
      `insert into payment_orders (id, user_id, group_id, amount_crypto_usdc, payment_method, status, proof_metadata)
       values ($1, $2, $3, $4, 'QR_SIMPLE', 'PENDING', $5::jsonb)`,
      [
        orderId,
        params.payer.user_id,
        params.group.id,
        params.amountUsd,
        JSON.stringify(metadata),
      ],
    );

    const negotiation = await this.payments.negotiatePayment({
      orderId,
      amountUsd: params.amountUsd,
      payTo: params.group.contract_address,
      description: `Cuota tanda ${params.group.name} (ciclo #${params.cycleIndex + 1})`,
      resource: `tanda:${params.group.id}:cycle:${params.cycleIndex}`,
    });

    await this.supabase.query(
      `update payment_orders
       set xdr_challenge = $1, qr_payload_url = $2, status = 'CLAIMED_BY_USER'
       where id = $3`,
      [negotiation.challenge ?? null, negotiation.qrBase64 ?? null, orderId],
    );

    const payUrl = this.paymentPage
      ? `${this.paymentPage.replace(/\/$/, '')}/pagos/${orderId}`
      : undefined;

    await this.messaging.sendPaymentRequest(
      payerPhone,
      {
        month: new Date().toLocaleString('es', { month: 'long' }),
        totalAmount: `$${params.amountUsd.toFixed(2)} USD`,
        exchangeRate: '1.00',
        groupName: params.group.name,
        paymentUrl: payUrl,
      },
      { phoneNumberId: this.phoneNumberId },
    );

    if (negotiation.qrBase64) {
      const qr = negotiation.qrBase64.trim();
      if (/^https?:\/\//i.test(qr)) {
        await this.messaging.sendImage(
          payerPhone,
          { link: qr },
          {
            phoneNumberId: this.phoneNumberId,
            caption:
              'Escanea el QR para pagar. Luego sube tu comprobante si aplica.',
          },
        );
      } else {
        this.logger.debug(
          `QR no es un link http(s); se omite imagen. order=${orderId}`,
        );
      }
    }

    if (this.paymentRequestStickerUrl) {
      await this.messaging.sendSticker(
        payerPhone,
        { link: this.paymentRequestStickerUrl },
        { phoneNumberId: this.phoneNumberId },
      );
    }
  }

  private normalizePhone(raw: string): string {
    return String(raw ?? '').replace(/\D/g, '');
  }
}
