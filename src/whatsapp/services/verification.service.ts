import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { SupabaseService } from './supabase.service';

interface VerificationRecord {
  code: string;
  expiresAt: Date;
  verified: boolean;
}

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);
  private readonly ttlMs = 10 * 60 * 1000; // 10 minutos
  private readonly fallbackStore = new Map<string, VerificationRecord>();

  constructor(private readonly supabase: SupabaseService) {}

  async issueCode(phone: string): Promise<{ code: string; expiresAt: Date }> {
    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + this.ttlMs);

    if (!this.supabase.isEnabled()) {
      this.fallbackStore.set(phone, { code, expiresAt, verified: false });
      return { code, expiresAt };
    }

    await this.supabase.query(
      `INSERT INTO verification_codes (phone_number, code, expires_at, verified_at)
       VALUES ($1, $2, $3, NULL)` as string,
      [phone, code, expiresAt.toISOString()],
    );

    return { code, expiresAt };
  }

  async confirmCode(phone: string, code: string): Promise<boolean> {
    if (!phone || !code) return false;

    if (!this.supabase.isEnabled()) {
      const record = this.fallbackStore.get(phone);
      if (!record || record.verified || record.expiresAt.getTime() < Date.now()) {
        return false;
      }
      if (record.code === code) {
        this.fallbackStore.set(phone, { ...record, verified: true });
        return true;
      }
      return false;
    }

    const rows = await this.supabase.query<{ id: number; code: string; expires_at: Date; verified_at: Date | null }>(
      `SELECT id, code, expires_at, verified_at
       FROM verification_codes
       WHERE phone_number = $1
       ORDER BY created_at DESC
       LIMIT 1` as string,
      [phone],
    );

    const record = rows[0];
    if (!record) return false;
    if (record.verified_at) return true;
    if (new Date(record.expires_at).getTime() < Date.now()) return false;
    if (record.code !== code) return false;

    await this.supabase.query(
      'UPDATE verification_codes SET verified_at = now() WHERE id = $1',
      [record.id],
    );
    return true;
  }

  async isVerified(phone: string): Promise<boolean> {
    if (!phone) return false;
    if (!this.supabase.isEnabled()) {
      const record = this.fallbackStore.get(phone);
      return Boolean(record?.verified && record.expiresAt.getTime() > Date.now());
    }

    const rows = await this.supabase.query<{ verified_at: Date | null; expires_at: Date }>(
      `SELECT verified_at, expires_at
       FROM verification_codes
       WHERE phone_number = $1
       ORDER BY created_at DESC
       LIMIT 1` as string,
      [phone],
    );

    if (!rows.length) return false;
    const latest = rows[0];
    if (new Date(latest.expires_at).getTime() < Date.now()) return false;
    return Boolean(latest.verified_at);
  }

  async tryConfirmFromMessage(phone: string, text: string): Promise<boolean> {
    const code = text?.replace(/\s+/g, '');
    if (!code) return false;
    const success = await this.confirmCode(phone, code);
    if (!success) {
      this.logger.debug(`Código de verificación no coincide para ${phone}`);
    }
    return success;
  }

  private generateCode(): string {
    const value = randomInt(100000, 999999);
    return String(value);
  }
}
