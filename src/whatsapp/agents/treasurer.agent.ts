import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { SupabaseService } from '../services/supabase.service';
import { PaymentIntegrationService } from '../services/payment-integration.service';
import type { RouterAction } from '../whatsapp.types';

export interface PaymentIntentPayload {
  amountUsd: number;
  payTo: string;
  description?: string;
}

@Injectable()
export class TreasurerAgentService {
  private readonly logger = new Logger(TreasurerAgentService.name);
  private readonly paymentPage: string;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly payments: PaymentIntegrationService,
    config: ConfigService,
  ) {
    this.paymentPage = config.get<string>('MAIN_PAGE_URL', '');
  }

  async handlePaymentRequest(params: {
    sender: string;
    payload: PaymentIntentPayload;
  }): Promise<RouterAction[]> {
    const orderId = randomUUID();

    await this.supabase.query(
      `INSERT INTO payment_orders (id, user_id, group_id, amount_crypto_usdc, payment_method, status)
       VALUES ($1, NULL, NULL, $2, $3, 'PENDING')` as string,
      [orderId, params.payload.amountUsd, 'QR_SIMPLE'],
    );

    const negotiation = await this.payments.negotiatePayment({
      orderId,
      amountUsd: params.payload.amountUsd,
      payTo: params.payload.payTo,
      description: params.payload.description,
    });

    await this.supabase.query(
      `UPDATE payment_orders SET xdr_challenge = $1, qr_payload_url = $2, status = 'CLAIMED_BY_USER' WHERE id = $3` as string,
      [negotiation.challenge ?? null, negotiation.qrBase64 ?? null, orderId],
    );

    const payUrl = this.paymentPage
      ? `${this.paymentPage.replace(/\/$/, '')}/pagos/${orderId}`
      : undefined;

    const actions: RouterAction[] = [
      {
        type: 'text',
        to: params.sender,
        text: `Generé tu enlace de pago. ${payUrl ? `Abre ${payUrl} para completar el pago.` : 'Completa el pago desde el portal configurado.'}`,
      },
    ];

    if (negotiation.qrBase64) {
      actions.push({
        type: 'image',
        to: params.sender,
        base64: negotiation.qrBase64,
        caption:
          'Escanea el QR para pagar en banco. Luego envía tu comprobante aquí.',
        mimeType: 'image/png',
      });
    }

    return actions;
  }

  async handleProofUpload(params: {
    orderId: string;
    proofMetadata: Record<string, unknown>;
  }): Promise<RouterAction[]> {
    const rows = await this.supabase.query<{ amount_crypto_usdc: number }>(
      `SELECT amount_crypto_usdc
       FROM payment_orders
       WHERE id = $1
       LIMIT 1` as string,
      [params.orderId],
    );
    const amountUsd = Number(rows[0]?.amount_crypto_usdc ?? 0);

    const verification = await this.payments.verifyFiat({
      orderId: params.orderId,
      amountUsd,
      proofMetadata: params.proofMetadata,
    });

    await this.supabase.query(
      `UPDATE payment_orders SET proof_metadata = $1, status = $2 WHERE id = $3` as string,
      [
        params.proofMetadata,
        verification.success ? 'VERIFIED' : 'REJECTED',
        params.orderId,
      ],
    );

    if (verification.success) {
      return [
        {
          type: 'text',
          to: undefined,
          text: 'Pago verificado ✅. Actualizaremos el contrato en Soroban y te avisaremos cuando se confirme en la red.',
        },
      ];
    }

    return [
      {
        type: 'text',
        to: undefined,
        text: 'No pudimos verificar el pago. Revisa los datos del comprobante e inténtalo de nuevo.',
      },
    ];
  }

  async handleWebhookSettlement(orderId: string): Promise<RouterAction[]> {
    await this.supabase.query(
      `UPDATE payment_orders SET status = 'COMPLETED' WHERE id = $1` as string,
      [orderId],
    );

    return [
      {
        type: 'text',
        text: 'Recibimos confirmación del pago. ¡Gracias! El turno quedará marcado como pagado.',
      },
    ];
  }
}
