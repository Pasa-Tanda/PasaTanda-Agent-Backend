import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GroupOnboardingService } from './services/group-onboarding.service';
import { VerificationService } from './services/verification.service';

class OnboardingDto {
  phoneNumber!: string;
  username!: string;
  groupName!: string;
  amountBs!: number;
  amountUsdc!: number;
  exchangeRate!: number;
  frequencyDays!: number;
  yieldEnabled!: boolean;
  verificationCode?: string;
}

@ApiTags('Onboarding')
@Controller('api/onboarding')
export class OnboardingController {
  constructor(
    private readonly onboarding: GroupOnboardingService,
    private readonly verificationService: VerificationService,
  ) {}

  @Get('/verify')
  @ApiOperation({ summary: 'Genera un código de verificación y lo devuelve al frontend' })
  async issueVerification(@Query('phone') phone: string) {
    if (!phone) {
      throw new HttpException('phone requerido', HttpStatus.BAD_REQUEST);
    }

    const { code, expiresAt } = await this.verificationService.issueCode(phone);
    return {
      phone,
      code,
      expiresAt,
      instructions: 'Envía este código por WhatsApp para validar tu número antes de crear la tanda.',
    };
  }

  @Post()
  @ApiOperation({ summary: 'Crea grupo + wallet + WA group + contrato' })
  async start(@Body() body: OnboardingDto) {
    if (!body.phoneNumber || !body.username || !body.groupName) {
      throw new HttpException('Faltan campos obligatorios', HttpStatus.BAD_REQUEST);
    }

    const amountBs = Number(body.amountBs ?? 0);
    const amountUsdc = Number(body.amountUsdc ?? 0);
    const exchangeRate = Number(body.exchangeRate ?? (amountUsdc ? amountBs / amountUsdc : 0));
    const frequencyDays = Number(body.frequencyDays ?? 30);
    const yieldEnabled = Boolean(body.yieldEnabled ?? true);

    if (!Number.isFinite(amountBs) || amountBs <= 0) {
      throw new HttpException('amountBs inválido', HttpStatus.BAD_REQUEST);
    }
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      throw new HttpException('amountUsdc inválido', HttpStatus.BAD_REQUEST);
    }

    if (body.verificationCode) {
      const confirmed = await this.verificationService.confirmCode(
        body.phoneNumber,
        body.verificationCode.replace(/\s+/g, ''),
      );
      if (!confirmed) {
        throw new HttpException('Código de verificación inválido o vencido', HttpStatus.BAD_REQUEST);
      }
    }

    try {
      const result = await this.onboarding.start({
        phoneNumber: body.phoneNumber,
        username: body.username,
        groupName: body.groupName,
        amountBs,
        amountUsdc,
        exchangeRate,
        frequencyDays,
        yieldEnabled,
        verificationCode: body.verificationCode,
      });
      return { success: true, ...result };
    } catch (error: any) {
      throw new HttpException(error?.message || 'No se pudo crear el grupo', HttpStatus.BAD_REQUEST);
    }
  }

  @Post(':groupId/start')
  @ApiOperation({ summary: 'Inicia la tanda: despliega contrato y genera orden de pago inicial' })
  async startTanda(
    @Param('groupId') groupId: string,
    @Body()
    body: {
      amountBs: number;
      amountUsdc: number;
      exchangeRate?: number;
      frequencyDays?: number;
      yieldEnabled?: boolean;
    },
  ) {
    const idNum = Number(groupId);
    if (!Number.isFinite(idNum)) {
      throw new HttpException('groupId inválido', HttpStatus.BAD_REQUEST);
    }

    const amountBs = Number(body.amountBs ?? 0);
    const amountUsdc = Number(body.amountUsdc ?? 0);
    if (!Number.isFinite(amountBs) || amountBs <= 0) {
      throw new HttpException('amountBs inválido', HttpStatus.BAD_REQUEST);
    }
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      throw new HttpException('amountUsdc inválido', HttpStatus.BAD_REQUEST);
    }

    const result = await this.onboarding.startTanda({
      groupId: idNum,
      amountBs,
      amountUsdc,
      exchangeRate: body.exchangeRate,
      frequencyDays: body.frequencyDays,
      yieldEnabled: body.yieldEnabled,
    });

    return { success: true, ...result };
  }
}
