import { IsString, IsOptional, IsBoolean, IsIn } from 'class-validator';

/**
 * DTO para el webhook de x402 que recibe actualizaciones de estado de pago.
 * Este endpoint es llamado por el payment backend cuando hay cambios en el estado
 * del pago (VERIFIED, SETTLED, CONFIRMED, FAILED, EXPIRED).
 */
export class X402WebhookDto {
  @IsString()
  jobId: string;

  @IsString()
  @IsIn([
    'X402_PAYMENT_REQUIRED',
    'X402_PAYMENT_VERIFIED',
    'X402_PAYMENT_SETTLED',
    'X402_PAYMENT_CONFIRMED',
    'X402_PAYMENT_FAILED',
    'X402_PAYMENT_EXPIRED',
    'FIAT_PAYMENT_CONFIRMED',
    'FIAT_PAYMENT_FAILED',
  ])
  event: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsBoolean()
  success?: boolean;

  @IsOptional()
  @IsIn(['fiat', 'crypto'])
  type?: 'fiat' | 'crypto';

  @IsOptional()
  @IsString()
  transaction?: string;

  @IsOptional()
  @IsString()
  network?: string;

  @IsOptional()
  @IsString()
  chainId?: string;

  @IsOptional()
  @IsString()
  payer?: string;

  @IsOptional()
  @IsString()
  errorReason?: string;
}

/**
 * DTO para confirmación de pago desde MAIN_PAGE_URL.
 * El frontend de pago llama a este endpoint cuando el usuario
 * confirma que realizó el pago.
 */
export class PaymentConfirmationDto {
  @IsString()
  orderId: string;

  @IsOptional()
  @IsIn(['fiat', 'crypto'])
  paymentMethod?: 'fiat' | 'crypto';

  @IsOptional()
  @IsString()
  transactionId?: string;
}
