import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendImageMessageDto {
  @ApiProperty({ example: '5215551234567' })
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiProperty({ example: 'https://example.com/image.jpg' })
  @IsString()
  @IsNotEmpty()
  imageUrl!: string;

  @ApiProperty({ required: false, example: 'Imagen de ejemplo' })
  @IsString()
  @IsOptional()
  caption?: string;
}
