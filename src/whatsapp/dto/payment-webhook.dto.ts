import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export enum PaymentWebhookEventEnum {
  QR_GENERATED = 'QR_GENERATED',
  VERIFICATION_RESULT = 'VERIFICATION_RESULT',
  LOGIN_2FA_REQUIRED = 'LOGIN_2FA_REQUIRED',
}

export type PaymentWebhookEvent = `${PaymentWebhookEventEnum}`;

export class PaymentWebhookDto {
  @ApiProperty({
    enum: [
      PaymentWebhookEventEnum.QR_GENERATED,
      PaymentWebhookEventEnum.VERIFICATION_RESULT,
      PaymentWebhookEventEnum.LOGIN_2FA_REQUIRED,
    ],
  })
  @IsEnum(PaymentWebhookEventEnum)
  event_type!: PaymentWebhookEvent;

  @ApiProperty()
  @IsString()
  order_id!: string;

  @ApiProperty({ required: false, description: 'Tenant asociado al evento' })
  @IsOptional()
  @IsString()
  company_id?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  qr_image_base64?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  mime_type?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  success?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  ref?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  timestamp?: string;
}

export interface PaymentWebhookAction {
  to: string;
  type: 'text' | 'image';
  text?: string;
  imageBase64?: string;
  mimeType?: string;
  caption?: string;
  companyId: string;
}
