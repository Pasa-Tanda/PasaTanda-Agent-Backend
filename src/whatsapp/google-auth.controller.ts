import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GoogleOauthService } from './services/google-oauth.service';
import { CompanyIntegrationsService } from './services/company-integrations.service';
import { WhatsappService } from './whatsapp.service';

interface GoogleStatePayload {
  company_id: string;
  admin_phone: string;
}

@ApiTags('Google OAuth')
@Controller('auth/google')
export class GoogleAuthController {
  private readonly logger = new Logger(GoogleAuthController.name);

  constructor(
    private readonly googleOauth: GoogleOauthService,
    private readonly integrationsService: CompanyIntegrationsService,
    private readonly whatsappService: WhatsappService,
  ) {}

  @Get('callback')
  @ApiOperation({ summary: 'Callback de OAuth2 para Google Calendar' })
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: ExpressResponse,
  ): Promise<void> {
    if (!code || !state) {
      res.status(400).send('Solicitud inválida');
      return;
    }

    try {
      const decoded: GoogleStatePayload = JSON.parse(
        Buffer.from(state, 'base64url').toString('utf8'),
      );

      const tokens = await this.googleOauth.exchangeCode(code);
      if (!tokens) {
        throw new Error('No se recibieron tokens de Google');
      }

      await this.integrationsService.upsertGoogleCalendar(decoded.company_id, {
        ...tokens,
      });

      await this.whatsappService.sendTextMessage(
        decoded.admin_phone,
        '✅ Calendario conectado exitosamente. Ya puedo sincronizar tus citas.',
        { companyId: decoded.company_id },
      );

      res.send('<h1>Conexión exitosa</h1><p>Regresa a WhatsApp.</p>');
    } catch (error) {
      const safeError = error as Error;
      this.logger.error('Error en callback de Google OAuth', safeError);
      res
        .status(500)
        .send('<h1>Error</h1><p>No se pudo completar la conexión.</p>');
    }
  }
}
