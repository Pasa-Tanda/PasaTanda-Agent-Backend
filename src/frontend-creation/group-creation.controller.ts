import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { GroupCreationService } from './group-creation.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Controller('api/frontend')
export class GroupCreationController {
  constructor(
    private readonly groupCreation: GroupCreationService,
    private readonly whatsapp: WhatsappService,
  ) {}

  @Get('verify')
  async verifyPhone(@Query('phone') phone?: string) {
    if (!phone || !this.isValidPhone(phone)) {
      throw new BadRequestException({
        success: false,
        message: 'Número de teléfono inválido',
      });
    }

    const { code, expiresAt } =
      await this.groupCreation.requestVerification(phone);
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
      whatsappUsername: status.whatsappUsername ?? null,
      username: status.whatsappUsername ?? null,
      whatsappNumber: status.whatsappNumber ?? null,
    };
  }

  @Post('create-group')
  async createGroup(
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
    const required = [
      'name',
      'phone',
      'whatsappUsername',
      'currency',
      'amount',
      'frequency',
    ] as const;
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

    const { userId, stellarPublicKey, normalizedPhone } =
      await this.groupCreation.upsertUser({
        phone: payload.phone!,
        username: payload.whatsappUsername!,
        preferredCurrency: payload.currency!,
      });

    const draftGroup = await this.groupCreation.createDraftGroup({
      name: payload.name!,
      amount: payload.amount!,
      frequencyDays: parseInt(payload.frequency!, 10),
      yieldEnabled: payload.enableYield ?? true,
    });

    await this.groupCreation.createMembership({
      userId,
      groupDbId: draftGroup.groupDbId,
      isAdmin: true,
      turnNumber: 1,
    });

    // 4. Enviar mensaje de confirmación por WhatsApp
    await this.whatsapp.sendTextMessage(
      normalizedPhone,
      '✅ Has creado tu grupo PasaTanda exitosamente. Envíame los contactos de los miembros que quieras agregar.',
    );

    return {
      success: true,
      groupId: draftGroup.groupId,
      groupDbId: draftGroup.groupDbId,
      userId,
      status: 'DRAFT',
      whatsappGroupJid: draftGroup.whatsappGroupJid,
      inviteLink: 'https://chat.whatsapp.com/placeholder',
      enableYield: draftGroup.enableYield,
      stellarPublicKey,
      message: 'Grupo creado. Comparte el link de invitación.',
    };
  }

  private isValidPhone(phone: string): boolean {
    const digitsOnly = phone.replace(/\D/g, '');
    return digitsOnly.length >= 8 && digitsOnly.length <= 15;
  }
}
