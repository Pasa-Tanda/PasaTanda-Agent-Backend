import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OnboardingService } from './onboarding.service';

@Controller('api/onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('verify')
  async verifyPhone(@Query('phone') phone?: string) {
    if (!phone || !this.isValidPhone(phone)) {
      throw new BadRequestException({
        success: false,
        message: 'Número de teléfono inválido',
      });
    }

    const { code, expiresAt } = await this.onboarding.requestVerification(phone);

    return {
      success: true,
      code,
      expiresAt,
      message: 'Envía este código al bot de WhatsApp',
    };
  }

  @Post()
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
      yieldShareBps?: number;
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

    return {
      success: true,
      groupId,
      status: 'DRAFT',
      whatsappGroupJid: `group-${groupId}@g.us`,
      inviteLink: 'https://chat.whatsapp.com/placeholder',
      message: 'Grupo creado. Comparte el link de invitación.',
    };
  }

  private isValidPhone(phone: string): boolean {
    return /^\+?\d{8,15}$/.test(phone);
  }
}