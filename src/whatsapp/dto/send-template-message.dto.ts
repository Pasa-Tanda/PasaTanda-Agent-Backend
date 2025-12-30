import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendTemplateMessageDto {
  @ApiProperty({ example: '5215551234567' })
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiProperty({ example: 'order_update' })
  @IsString()
  @IsNotEmpty()
  templateName!: string;

  @ApiProperty({ required: false, example: 'es' })
  @IsString()
  @IsOptional()
  languageCode?: string;

  @ApiProperty({ required: false, type: [Object] })
  @IsOptional()
  @IsArray()
  components?: Record<string, unknown>[];
}
