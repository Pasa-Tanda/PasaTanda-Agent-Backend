import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { createHmac } from 'crypto';
import { firstValueFrom } from 'rxjs';

interface VerificationPayload {
  phone: string;
  verified: boolean;
  timestamp: number;
  whatsappUsername?: string;
  whatsappNumber?: string;
}

@Injectable()
export class FrontendWebhookService {
  private readonly logger = new Logger(FrontendWebhookService.name);
  private readonly webhookBase: string;
  private readonly secret?: string;

  constructor(
    config: ConfigService,
    private readonly http: HttpService,
  ) {
    this.webhookBase =
      config.get<string>('FRONTEND_WEBHOOK_URL') ||
      config.get<string>('NEXT_PUBLIC_FRONTEND_URL') ||
      config.get<string>('MAIN_PAGE_URL', '');
    this.secret = config.get<string>('WEBHOOK_SECRET');
  }

  async sendVerificationConfirmation(payload: VerificationPayload): Promise<void> {
    if (!this.webhookBase) {
      this.logger.warn('Webhook base URL no configurada, se omite confirmación');
      return;
    }

    const url = `${this.webhookBase.replace(/\/$/, '')}/api/webhook/confirm_verification`;
    const body = {
      phone: payload.phone,
      verified: payload.verified,
      timestamp: payload.timestamp,
      whatsappUsername: payload.whatsappUsername,
      whatsappNumber: payload.whatsappNumber,
    };

    const headers: Record<string, string> = {};
    const serialized = JSON.stringify(body);
    if (this.secret) {
      const signature = createHmac('sha256', this.secret).update(serialized).digest('hex');
      headers['x-signature'] = signature;
    }

    try {
      await firstValueFrom(this.http.post(url, body, { headers }));
      this.logger.log(`Webhook de verificación enviado a ${url}`);
    } catch (error) {
      const safe = error as Error & { response?: { status?: number; data?: unknown } };
      this.logger.warn(
        `No se pudo notificar verificación (${safe.response?.status ?? 'sin status'}): ${safe.message}`,
      );
      if (safe.response?.data) {
        this.logger.debug(`Respuesta del webhook: ${JSON.stringify(safe.response.data)}`);
      }
    }
  }
}
