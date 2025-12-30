import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { PaymentOrder, PaymentState } from '../whatsapp.types';

interface OrderRow {
  id: string;
}

/**
 * Metadata extendida de la orden para guardar en Supabase
 */
interface OrderMetadata {
  client_phone: string;
  details: string;
  /** Job ID de pago para tracking */
  payment_job_id?: string;
  /** URL de pago generada */
  payment_url?: string;
  /** product_retailer_id del mensaje de WhatsApp */
  referred_product_id?: string;
  /** catalog_id del mensaje de WhatsApp */
  referred_catalog_id?: string;
}

@Injectable()
export class OrdersSyncService {
  private readonly logger = new Logger(OrdersSyncService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async syncDraft(order: PaymentOrder): Promise<string | undefined> {
    if (!this.supabase.isEnabled()) {
      this.logger.warn('Supabase no habilitado, no se puede guardar orden');
      return order.supabaseOrderId;
    }
    
    if (!order.amount) {
      this.logger.warn('Orden sin monto, no se puede guardar');
      return order.supabaseOrderId;
    }

    if (!order.userId) {
      this.logger.warn(
        `Orden ${order.orderId} sin userId. Se intentará guardar con cliente pendiente.`,
      );
    }

    const state = this.mapState(order.state);
    const metadata: OrderMetadata = {
      client_phone: order.clientPhone,
      details: order.details,
      payment_job_id: order.x402JobId,
      payment_url: order.paymentUrl,
      referred_product_id: order.referredProductId,
      referred_catalog_id: order.referredCatalogId,
    };

    this.logger.debug(
      `Guardando orden: company=${order.companyId}, user=${order.userId}, amount=${order.amount}`,
    );

    const rows = await this.supabase.query<OrderRow>(
      `INSERT INTO public.orders (company_id, user_id, total_amount, status, details, metadata)
       VALUES ($1, $2, $3, $4::order_status, $5, $6::jsonb)
       ON CONFLICT (company_id, details)
       DO UPDATE SET total_amount = EXCLUDED.total_amount, status = EXCLUDED.status, metadata = EXCLUDED.metadata, user_id = COALESCE(EXCLUDED.user_id, orders.user_id), updated_at = now()
       RETURNING id`,
      [
        order.companyId,
        order.userId,
        order.amount,
        state,
        order.details,
        JSON.stringify(metadata),
      ],
    );

    const dbId = rows[0]?.id;
    if (!dbId) {
      this.logger.error('No se pudo guardar la orden en Supabase');
      return order.supabaseOrderId;
    }

    this.logger.log(`Orden guardada exitosamente en Supabase: ${dbId}`);
    return dbId;
  }

  async updateStatus(order: PaymentOrder): Promise<void> {
    if (!this.supabase.isEnabled() || !order.supabaseOrderId) {
      return;
    }

    // Actualizar metadata si hay datos de x402
    const metadata: Partial<OrderMetadata> = {};
    if (order.x402JobId) metadata.payment_job_id = order.x402JobId;
    if (order.paymentUrl) metadata.payment_url = order.paymentUrl;

    const hasMetadataUpdates = Object.keys(metadata).length > 0;

    if (hasMetadataUpdates) {
      await this.supabase.query(
        `UPDATE public.orders
         SET status = $2::order_status,
             metadata = metadata || $3::jsonb,
             updated_at = now()
         WHERE id = $1`,
        [order.supabaseOrderId, this.mapState(order.state), JSON.stringify(metadata)],
      );
    } else {
      await this.supabase.query(
        `UPDATE public.orders
         SET status = $2::order_status, updated_at = now()
         WHERE id = $1`,
        [order.supabaseOrderId, this.mapState(order.state)],
      );
    }
  }

  /**
   * Busca una orden por su x402_job_id
   */
  async findByX402JobId(
    jobId: string,
  ): Promise<{ id: string; company_id: string; details: string } | null> {
    if (!this.supabase.isEnabled()) {
      return null;
    }

    const rows = await this.supabase.query<{
      id: string;
      company_id: string;
      details: string;
    }>(
      `SELECT id, company_id, details
       FROM public.orders
       WHERE metadata->>'x402_job_id' = $1
       LIMIT 1`,
      [jobId],
    );

    return rows[0] ?? null;
  }

  private mapState(state: PaymentState): string {
    switch (state) {
      case PaymentState.AWAITING_QR:
        return 'AWAITING_QR';
      case PaymentState.QR_SENT:
        return 'QR_SENT';
      case PaymentState.VERIFYING:
        return 'VERIFYING_PAYMENT';
      case PaymentState.COMPLETED:
        return 'COMPLETED';
      case PaymentState.CART:
      default:
        return 'CART';
    }
  }
}
