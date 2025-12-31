import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { GroupCreationService } from './group-creation.service';

@Controller('api/frontend')
export class GroupCreationController {
  constructor(private readonly groupCreation: GroupCreationService) {}

  @Get('verify')
  async verifyPhone(@Query('phone') phone?: string) {
    if (!phone || !this.isValidPhone(phone)) {
      throw new BadRequestException({
        success: false,
        message: 'Número de teléfono inválido',
      });
    }

    const { code, expiresAt } = await this.groupCreation.requestVerification(phone);
    const latest = await this.groupCreation.getLatestRecord(phone);

    return {
      success: true,
      code,
      expiresAt,
      whatsappUsername: latest?.whatsappUsername ?? null,
      username: latest?.whatsappUsername ?? null,
      message: 'Envía este código al bot de WhatsApp',
    };
  }

  @Get('confirm-verification')
  async confirmVerification(@Query('phone') phone?: string) {
    if (!phone) {
      throw new BadRequestException({
        success: false,
        message: 'Missing required field: phone',
      });
    }

    const status = await this.groupCreation.getVerificationStatus(phone);

    return {
      success: true,
      verified: status.verified,
      timestamp: status.timestamp,
      username: status.whatsappUsername ?? null,
    };
  }

  @Post('create-group')
  createGroup(
    @Body()
    payload: {
      name?: string;
      phone?: string;
      whatsappUsername?: string;
      currency?: string;
      amount?: number;
      frequency?: string;
      enableYield?: boolean;
    },
  ) {
    const required = ['name', 'phone', 'whatsappUsername', 'currency', 'amount', 'frequency'] as const;
    const missing = required.filter((key) => !payload[key]);
    if (missing.length > 0) {
      throw new BadRequestException({
        success: false,
        message: `Faltan campos obligatorios: ${missing.join(', ')}`,
      });
    }

    if (!this.isValidPhone(payload.phone!)) {
      throw new BadRequestException({
        success: false,
        message: 'Número de teléfono inválido',
      });
    }

    const groupId = randomUUID();
    const shareYieldInfo = payload.enableYield ?? true;

    return {
      success: true,
      groupId,
      status: 'DRAFT',
      whatsappGroupJid: `group-${groupId}@g.us`,
      inviteLink: 'https://chat.whatsapp.com/placeholder',
      enableYield: shareYieldInfo,
      message: 'Grupo creado. Comparte el link de invitación.',
    };
  }

  private isValidPhone(phone: string): boolean {
    const digitsOnly = phone.replace(/\D/g, '');
    return digitsOnly.length >= 8 && digitsOnly.length <= 15;
  }
}
