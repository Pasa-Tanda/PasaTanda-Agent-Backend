import { Injectable, Logger } from '@nestjs/common';
import { OnboardingService } from '../../onboarding/onboarding.service';

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(private readonly onboarding: OnboardingService) {}

  async issueCode(phone: string): Promise<{ code: string; expiresAt: Date }> {
    const { code, expiresAt } = await this.onboarding.requestVerification(phone);
    return { code, expiresAt: new Date(expiresAt) };
  }

  async confirmCode(phone: string, code: string): Promise<boolean> {
    if (!phone || !code) return false;

    const success = await this.onboarding.verifyCode(phone, code);
    if (!success) {
      this.logger.debug(`Código OTP inválido para ${phone}`);
    }
    return success;
  }

  async isVerified(phone: string): Promise<boolean> {
    if (!phone) return false;
    const status = await this.onboarding.getVerificationStatus(phone);
    return Boolean(status.verified);
  }

  async tryConfirmFromMessage(phone: string, text: string): Promise<boolean> {
    if (!text) return false;

    const code = this.extractCodeFromMessage(text);
    if (!code) {
      this.logger.debug('No se encontró un código delimitado por ~* en el mensaje entrante.');
      return false;
    }

    const onboardingRecord = await this.onboarding.getLatestRecord(phone);
    const expectedCode = onboardingRecord?.code ?? 'N/A';
    this.logger.debug(
      `Verificación: código extraído ${code}, código esperado ${expectedCode} (telefono: ${phone})`,
    );

    return this.confirmCode(phone, code);
  }

  private extractCodeFromMessage(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed) {
      return null;
    }

    const firstMarker = trimmed.indexOf('~*');
    if (firstMarker === -1) {
      return null;
    }

    const secondMarker = trimmed.indexOf('~*', firstMarker + 2);
    if (secondMarker > firstMarker + 2) {
      const candidate = trimmed.slice(firstMarker + 2, secondMarker).trim();
      return candidate.length ? candidate : null;
    }

    const closingMarker = trimmed.indexOf('*~', firstMarker + 2);
    if (closingMarker > firstMarker + 2) {
      const candidate = trimmed.slice(firstMarker + 2, closingMarker).trim();
      return candidate.length ? candidate : null;
    }

    return null;
  }
}
