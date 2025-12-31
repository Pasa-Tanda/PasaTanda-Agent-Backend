import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../whatsapp/services/supabase.service';

type VerificationRecord = {
  phone: string;
  code: string | null;
  expiresAt: number;
  verified: boolean;
  timestamp: number | null;
  whatsappUsername?: string;
  whatsappNumber?: string;
};

type DbVerificationRow = {
  id: number;
  phone: string;
  code: string | null;
  expires_at: string | null;
  verified: boolean;
  verified_at: string | null;
  whatsapp_username: string | null;
  whatsapp_number: string | null;
};

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);
  private readonly ttlMs = 10 * 60 * 1000;

  constructor(private readonly supabase: SupabaseService) {}

  async requestVerification(phone: string): Promise<{ code: string; expiresAt: number }> {
    this.ensureSupabaseReady();
    const code = this.generateCode();
    const expiresAt = Date.now() + this.ttlMs;
    const expiresAtDate = new Date(expiresAt);

    await this.supabase.query(
      `
        insert into verification_codes (phone, code, expires_at, verified, verified_at, whatsapp_username, whatsapp_number)
        values ($1, $2, $3, false, null, null, null)
        on conflict (phone)
        do update set
          code = excluded.code,
          expires_at = excluded.expires_at,
          verified = false,
          verified_at = null,
          whatsapp_username = null,
          whatsapp_number = null
      `,
      [phone, code, expiresAtDate],
    );

    return { code, expiresAt };
  }

  async confirmVerification(params: {
    phone: string;
    verified: boolean;
    timestamp?: number;
    whatsappUsername?: string;
    whatsappNumber?: string;
  }): Promise<VerificationRecord> {
    this.ensureSupabaseReady();
    const verifiedAtDate = params.verified
      ? new Date(params.timestamp ?? Date.now())
      : null;

    const rows = await this.supabase.query<DbVerificationRow>(
      `
        insert into verification_codes (phone, code, expires_at, verified, verified_at, whatsapp_username, whatsapp_number)
        values ($1, null, timezone('utc', now()) + interval '10 minutes', $2, $3, $4, $5)
        on conflict (phone)
        do update set
          verified = excluded.verified,
          verified_at = excluded.verified_at,
          whatsapp_username = excluded.whatsapp_username,
          whatsapp_number = excluded.whatsapp_number,
          code = case when excluded.verified then null else verification_codes.code end,
          expires_at = case when excluded.verified then excluded.verified_at else verification_codes.expires_at end
        returning *
      `,
      [
        params.phone,
        params.verified,
        verifiedAtDate,
        params.whatsappUsername ?? null,
        params.whatsappNumber ?? null,
      ],
    );

    const row = rows[0];
    if (!row) {
      throw new Error(`No se pudo confirmar la verificación para ${params.phone}`);
    }

    return this.mapRowToRecord(row);
  }

  async getLatestRecord(phone: string): Promise<VerificationRecord | undefined> {
    this.ensureSupabaseReady();
    const row = await this.getRowByPhone(phone);
    return row ? this.mapRowToRecord(row) : undefined;
  }

  async verifyCode(phone: string, code: string): Promise<boolean> {
    this.ensureSupabaseReady();
    const normalizedCode = code.trim();
    if (!normalizedCode) return false;

    const row = await this.getRowByPhone(phone);
    if (!row || !row.code) {
      return false;
    }

    const expiresAt = this.parseTimestamp(row.expires_at);
    if (expiresAt && expiresAt < Date.now()) {
      await this.deleteRow(row.id);
      return false;
    }

    if (row.code.trim().toUpperCase() !== normalizedCode.toUpperCase()) {
      return false;
    }

    await this.supabase.query(
      `
        update verification_codes
        set verified = true,
            verified_at = timezone('utc', now()),
            code = null,
            expires_at = timezone('utc', now())
        where id = $1
      `,
      [row.id],
    );

    return true;
  }

  async getVerificationStatus(phone: string) {
    this.ensureSupabaseReady();
    const row = await this.getRowByPhone(phone);

    if (!row) {
      return {
        verified: false,
        timestamp: null,
        whatsappUsername: undefined,
        whatsappNumber: undefined,
      };
    }

    return {
      verified: row.verified,
      timestamp: this.parseTimestamp(row.verified_at),
      whatsappUsername: row.whatsapp_username ?? undefined,
      whatsappNumber: row.whatsapp_number ?? undefined,
    };
  }

  private async getRowByPhone(phone: string): Promise<DbVerificationRow | null> {
    const rows = await this.supabase.query<DbVerificationRow>(
      `
        select id, phone, code, expires_at, verified, verified_at, whatsapp_username, whatsapp_number
        from verification_codes
        where phone = $1
        limit 1
      `,
      [phone],
    );

    return rows[0] ?? null;
  }

  private mapRowToRecord(row: DbVerificationRow): VerificationRecord {
    return {
      phone: row.phone,
      code: row.code,
      expiresAt: this.parseTimestamp(row.expires_at) ?? Date.now(),
      verified: row.verified,
      timestamp: this.parseTimestamp(row.verified_at),
      whatsappUsername: row.whatsapp_username ?? undefined,
      whatsappNumber: row.whatsapp_number ?? undefined,
    };
  }

  private parseTimestamp(value: string | null): number | null {
    if (!value) {
      return null;
    }
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }

  private async deleteRow(id: number): Promise<void> {
    await this.supabase.query('delete from verification_codes where id = $1', [id]);
  }

  private ensureSupabaseReady(): void {
    if (!this.supabase.isEnabled()) {
      this.logger.error(
        'SupabaseService no está configurado. Asegúrate de definir SUPABASE_DB_URL o POSTGRES_URL* para habilitar verificaciones OTP.',
      );
      throw new Error('Servicio de verificación OTP deshabilitado por falta de conexión a Supabase');
    }
  }

  private generateCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i += 1) {
      const idx = Math.floor(Math.random() * alphabet.length);
      code += alphabet[idx];
    }
    return code;
  }
}