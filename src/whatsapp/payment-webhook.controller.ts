import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import { X402WebhookDto, PaymentConfirmationDto } from './dto/x402-webhook.dto';
import { TreasurerAgentService } from './agents/treasurer.agent';
import { WhatsappService } from './whatsapp.service';

@ApiTags('Payment Webhook')
@Controller('webhook')
export class PaymentWebhookController {
  private readonly logger = new Logger(PaymentWebhookController.name);

  constructor(
    private readonly treasurerAgentService: TreasurerAgentService,
    private readonly whatsappService: WhatsappService,
  ) {}

  @Post('payments/result')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Recibe eventos del microservicio de pagos (legacy)' })
  async handlePaymentEvent(
    @Body() payload: PaymentWebhookDto,
  ): Promise<{ status: string }> {
    this.logger.log(
      `Pago webhook: ${payload.event_type} para ${payload.order_id}`,
    );
    const actions = await this.treasurerAgentService.handleWebhookSettlement(payload.order_id);

    for (const action of actions) {
      if (action.type === 'text' && action.text && action.to) {
        await this.whatsappService.sendTextMessage(action.to, action.text, {});
      } else if (action.type === 'image' && action.base64 && action.to) {
        await this.whatsappService.sendImageFromBase64(
          action.to,
          action.base64,
          action.mimeType,
          action.caption,
          {},
        );
      }
    }

    return { status: 'received' };
  }

  /**
   * Endpoint para recibir webhooks de x402 (pagos fiat y crypto).
   * Este endpoint es llamado por el payment backend cuando hay cambios
   * en el estado del pago.
   */
  @Post('x402/result')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Recibe eventos del flujo x402 (fiat QR y crypto)' })
  async handleX402Event(
    @Body() payload: X402WebhookDto,
  ): Promise<{ status: string }> {
    this.logger.log(
      `x402 webhook: ${payload.event} para job ${payload.jobId}`,
    );

    const actions = await this.treasurerAgentService.handleWebhookSettlement(
      payload.jobId ?? payload.orderId ?? '',
    );

    for (const action of actions) {
      if (action.type === 'text' && action.text && action.to) {
        await this.whatsappService.sendTextMessage(action.to, action.text, {});
      } else if (action.type === 'image' && action.base64 && action.to) {
        await this.whatsappService.sendImageFromBase64(
          action.to,
          action.base64,
          action.mimeType,
          action.caption,
          {},
        );
      }
    }

    return { status: 'received' };
  }

  /**
   * Endpoint para confirmación de pago desde la página de pago (MAIN_PAGE_URL).
   * El frontend de pago llama a este endpoint cuando el usuario confirma
   * que realizó el pago (ya sea escaneando QR o usando crypto).
   */
  @Post('payment/confirm')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Confirmación de pago desde página de pago' })
  async handlePaymentConfirmation(
    @Body() payload: PaymentConfirmationDto,
  ): Promise<{ status: string; message: string }> {
    this.logger.log(
      `Confirmación de pago recibida para orden ${payload.orderId}`,
    );

    const actions = await this.treasurerAgentService.handleWebhookSettlement(payload.orderId);

    if (actions.length) {
      for (const action of actions) {
        if (action.type === 'text' && action.text && action.to) {
          await this.whatsappService.sendTextMessage(action.to, action.text, {});
        }
      }
    }

    return { status: 'received', message: 'Confirmación recibida' };
  }
}
