import { Injectable, Logger } from '@nestjs/common';
import type {
  AdkSessionSnapshot,
  Intent,
  SanitizedTextResult,
  TenantContext,
  UserRole,
} from '../whatsapp.types';
import { SupabaseService } from './supabase.service';

interface AdkSessionRow {
  session_id: string;
  company_id: string;
  context_data: unknown;
}

@Injectable()
export class AdkSessionService {
  private readonly logger = new Logger(AdkSessionService.name);
  private readonly fallbackSessions = new Map<string, AdkSessionSnapshot>();

  constructor(private readonly supabase: SupabaseService) {}

  async loadSession(
    tenant: TenantContext,
    senderId: string,
    role: UserRole,
  ): Promise<AdkSessionSnapshot> {
    const sessionId = this.buildSessionId(tenant.companyId, senderId);
    const existing = await this.fetchSession(sessionId);

    const baseContext = this.buildBaseContext(tenant, role);
    let mergedContext = { ...baseContext };

    if (existing) {
      mergedContext = {
        ...existing.context,
        ...baseContext,
        company_name: baseContext.company_name,
        company_tone: baseContext.company_tone,
        inventory_context: baseContext.inventory_context,
        today_date: baseContext.today_date,
        user_role: baseContext.user_role,
      };
    }

    const snapshot: AdkSessionSnapshot = {
      sessionId,
      companyId: tenant.companyId,
      senderId,
      context: mergedContext,
    };

    await this.persistSession(snapshot);
    return snapshot;
  }

  async recordInteraction(params: {
    session: AdkSessionSnapshot;
    intent: Intent | 'FALLBACK';
    sanitized: SanitizedTextResult;
  }): Promise<void> {
    const updatedContext = {
      ...params.session.context,
      last_intent: params.intent,
      last_user_text: params.sanitized.normalizedText,
      last_updated_at: new Date().toISOString(),
      tokens: params.sanitized.tokens,
    };

    params.session.context = updatedContext;
    await this.persistSession({
      ...params.session,
      context: updatedContext,
    });
  }

  private async fetchSession(
    sessionId: string,
  ): Promise<AdkSessionSnapshot | null> {
    if (this.fallbackSessions.has(sessionId)) {
      return this.fallbackSessions.get(sessionId) ?? null;
    }

    if (!this.supabase.isEnabled()) {
      this.logger.warn(
        `Supabase no disponible, usando sesión en memoria para ${sessionId}.`,
      );
      return null;
    }

    const rows = await this.supabase.query<AdkSessionRow>(
      'SELECT session_id, company_id, context_data FROM public.adk_sessions WHERE session_id = $1 LIMIT 1',
      [sessionId],
    );

    if (!rows.length) {
      return null;
    }

    const context = this.parseContext(rows[0].context_data);

    const snapshot: AdkSessionSnapshot = {
      sessionId: rows[0].session_id,
      companyId: rows[0].company_id,
      senderId: this.extractSenderId(rows[0].session_id),
      context,
    };

    this.fallbackSessions.set(sessionId, snapshot);
    return snapshot;
  }

  private parseContext(value: unknown): Record<string, unknown> {
    if (!value) {
      return {};
    }

    if (typeof value === 'object') {
      return value as Record<string, unknown>;
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as Record<string, unknown>;
      } catch {
        return {};
      }
    }

    return {};
  }

  private buildBaseContext(tenant: TenantContext, role: UserRole) {
    const config = tenant.companyConfig ?? {};
    const tone =
      (config.company_tone as string) ??
      (config.companyTone as string) ??
      (config.tone as string) ??
      'Neutral';
    const inventoryContext =
      (config.inventory_context as string) ??
      (config.inventoryContext as string) ??
      'Inventario General';

    return {
      company_name: tenant.companyName,
      company_tone: tone,
      inventory_context: inventoryContext,
      today_date: new Date().toISOString().slice(0, 10),
      user_role: role,
    };
  }

  private buildSessionId(companyId: string, senderId: string): string {
    return `${companyId}:${this.cleanNumber(senderId)}`;
  }

  private extractSenderId(sessionId: string): string {
    const [, sender] = sessionId.split(':');
    return sender ?? sessionId;
  }

  private cleanNumber(value: string): string {
    return value.replace(/\D/g, '');
  }

  private async persistSession(snapshot: AdkSessionSnapshot): Promise<void> {
    this.fallbackSessions.set(snapshot.sessionId, snapshot);

    if (!this.supabase.isEnabled()) {
      return;
    }

    await this.supabase.query(
      `INSERT INTO public.adk_sessions (session_id, company_id, context_data, updated_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (session_id)
       DO UPDATE SET context_data = EXCLUDED.context_data, updated_at = now()`,
      [
        snapshot.sessionId,
        snapshot.companyId,
        JSON.stringify(snapshot.context),
      ],
    );
  }
}
