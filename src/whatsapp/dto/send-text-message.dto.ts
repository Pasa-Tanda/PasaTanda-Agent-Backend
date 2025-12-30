import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SendTextMessageDto {
  @ApiProperty({
    example: '5215551234567',
    description: 'WhatsApp number in international format',
  })
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiProperty({ example: 'Hola, ¿cómo puedo ayudarte?' })
  @IsString()
  @IsNotEmpty()
  message!: string;
}
