import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SupabaseService } from './services/supabase.service';
import { PaymentIntegrationService } from './services/payment-integration.service';
import { TreasurerAgentService } from './agents/treasurer.agent';

class ClaimOrderDto {
  paymentType!: 'fiat' | 'crypto';
  proofMetadata?: Record<string, any>;
  xPayment?: string;
}

@ApiTags('Payment Orders')
@Controller('api/orders')
export class PaymentOrdersController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly payments: PaymentIntegrationService,
    private readonly treasurer: TreasurerAgentService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Devuelve el estado de una orden de pago' })
  async getOrder(@Param('id') id: string) {
    const rows = await this.supabase.query<{
      id: string;
      status: string;
      amount_fiat: number;
      currency_fiat: string;
      amount_crypto_usdc: number;
      qr_payload_url?: string;
      xdr_challenge?: string;
      proof_metadata?: any;
      group_id?: number;
    }>(
      `SELECT id, status, amount_fiat, currency_fiat, amount_crypto_usdc, qr_payload_url, xdr_challenge, proof_metadata, group_id
       FROM payment_orders
       WHERE id = $1
       LIMIT 1` as string,
      [id],
    );

    const order = rows[0];
    if (!order) {
      throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);
    }

    return {
      id: order.id,
      status: order.status,
      amountFiat: order.amount_fiat,
      currencyFiat: order.currency_fiat,
      amountUsdc: order.amount_crypto_usdc,
      qrPayloadUrl: order.qr_payload_url,
      xdrChallenge: order.xdr_challenge,
      proofMetadata: order.proof_metadata,
      groupId: order.group_id,
    };
  }

  @Post(':id/claim')
  @ApiOperation({
    summary:
      'Marca la orden como reclamada por el usuario y dispara validación',
  })
  async claimOrder(@Param('id') id: string, @Body() body: ClaimOrderDto) {
    if (!body.paymentType) {
      throw new HttpException('paymentType requerido', HttpStatus.BAD_REQUEST);
    }

    if (body.paymentType === 'fiat') {
      if (!body.proofMetadata) {
        throw new HttpException(
          'proofMetadata requerido para fiat',
          HttpStatus.BAD_REQUEST,
        );
      }

      await this.supabase.query(
        'UPDATE payment_orders SET status = $1, proof_metadata = $2 WHERE id = $3',
        ['PENDING_CONFIRMATION', body.proofMetadata, id],
      );

      const actions = await this.treasurer.handleProofUpload({
        orderId: id,
        proofMetadata: body.proofMetadata,
      });

      return { success: true, status: 'PENDING_CONFIRMATION', actions };
    }

    if (body.paymentType === 'crypto') {
      if (!body.xPayment) {
        throw new HttpException(
          'xPayment requerido para crypto',
          HttpStatus.BAD_REQUEST,
        );
      }

      const rows = await this.supabase.query<{ amount_crypto_usdc: number }>(
        `SELECT amount_crypto_usdc
         FROM payment_orders
         WHERE id = $1
         LIMIT 1`,
        [id],
      );
      const amountUsd = Number(rows[0]?.amount_crypto_usdc ?? 0);

      const { success, txHash } = await this.payments.forwardCrypto({
        orderId: id,
        amountUsd,
        xPayment: body.xPayment,
      });

      await this.supabase.query(
        'UPDATE payment_orders SET status = $1 WHERE id = $2',
        [success ? 'CONFIRMED' : 'REJECTED', id],
      );

      return { success, txHash, status: success ? 'CONFIRMED' : 'REJECTED' };
    }

    throw new HttpException('paymentType inválido', HttpStatus.BAD_REQUEST);
  }
}
