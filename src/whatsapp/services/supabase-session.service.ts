import { Injectable, Logger } from '@nestjs/common';
import { BaseSessionService } from '@google/adk';
import type {
  AppendEventRequest,
  CreateSessionRequest,
  DeleteSessionRequest,
  Event,
  GetSessionRequest,
  ListSessionsRequest,
  ListSessionsResponse,
  Session,
} from '@google/adk';
import { SupabaseService } from './supabase.service';

interface AdkSessionRow {
  session_id: string;
  app_name: string;
  user_id: string;
  events: unknown;
  state: unknown;
  last_update_time: string;
  created_at: string;
}

/**
 * Implementación de BaseSessionService de ADK usando Supabase como backend.
 * Permite persistir las sesiones de los agentes entre invocaciones.
 */
@Injectable()
export class SupabaseSessionService extends BaseSessionService {
  private readonly logger = new Logger(SupabaseSessionService.name);
  private readonly fallbackSessions = new Map<string, Session>();

  constructor(private readonly supabase: SupabaseService) {
    super();
  }

  /**
   * Crea una nueva sesión
   */
  async createSession({
    appName,
    userId,
    sessionId,
    state,
  }: CreateSessionRequest): Promise<Session> {
    const resolvedSessionId = sessionId ?? `${appName}:${userId}`;
    const initialState = this.stripTempState(state ?? {});

    const session: Session = {
      id: resolvedSessionId,
      appName,
      userId,
      state: initialState,
      events: [],
      lastUpdateTime: Date.now(),
    };

    // Intentar guardar en Supabase
    if (this.supabase.isEnabled()) {
      try {
        await this.supabase.query(
          `INSERT INTO adk_sessions (session_id, app_name, user_id, events, state, last_update_time)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, NOW())
           ON CONFLICT (session_id)
           DO UPDATE SET 
             events = EXCLUDED.events,
             state = EXCLUDED.state,
             last_update_time = NOW()`,
          [
            resolvedSessionId,
            appName,
            userId,
            JSON.stringify(session.events),
            JSON.stringify(initialState),
          ],
        );
        this.logger.debug(`Sesión creada en Supabase: ${resolvedSessionId}`);
      } catch (error) {
        this.logger.error(
          `Error creando sesión en Supabase: ${(error as Error).message}`,
        );
      }
    }

    // Siempre guardar en memoria como fallback
    this.fallbackSessions.set(resolvedSessionId, session);
    return session;
  }

  /**
   * Obtiene una sesión existente
   */
  async getSession({
    appName,
    userId,
    sessionId,
    config,
  }: GetSessionRequest): Promise<Session | undefined> {
    // Primero intentar desde Supabase
    if (this.supabase.isEnabled()) {
      try {
        const rows = await this.supabase.query<AdkSessionRow>(
          `SELECT session_id, app_name, user_id, events, state, last_update_time, created_at
           FROM adk_sessions
           WHERE session_id = $1 AND app_name = $2
           LIMIT 1`,
          [sessionId, appName],
        );

        if (rows.length > 0) {
          const row = rows[0];
          const loadedSession = this.rowToSession(row);
          const filteredSession = this.applyGetConfig(loadedSession, config);
          this.fallbackSessions.set(sessionId, filteredSession);
          return filteredSession;
        }
      } catch (error) {
        this.logger.error(
          `Error obteniendo sesión de Supabase: ${(error as Error).message}`,
        );
      }
    }

    // Fallback a memoria
    const cached = this.fallbackSessions.get(sessionId);
    return cached ? this.applyGetConfig(cached, config) : undefined;
  }

  /**
   * Lista las sesiones de un usuario
   */
  async listSessions({
    appName,
    userId,
  }: ListSessionsRequest): Promise<ListSessionsResponse> {
    const sessions: Session[] = [];

    if (this.supabase.isEnabled()) {
      try {
        const rows = await this.supabase.query<AdkSessionRow>(
          `SELECT session_id, app_name, user_id, events, state, last_update_time, created_at
           FROM adk_sessions
           WHERE app_name = $1 AND user_id = $2
           ORDER BY last_update_time DESC`,
          [appName, userId],
        );

        for (const row of rows) {
          const full = this.rowToSession(row);
          sessions.push({
            id: full.id,
            appName: full.appName,
            userId: full.userId,
            state: {},
            events: [],
            lastUpdateTime: full.lastUpdateTime,
          });
        }
      } catch (error) {
        this.logger.error(
          `Error listando sesiones de Supabase: ${(error as Error).message}`,
        );
      }
    }

    // Si no hay sesiones de Supabase, buscar en memoria
    if (sessions.length === 0) {
      for (const [id, session] of this.fallbackSessions) {
        if (session.appName === appName && session.userId === userId) {
          sessions.push({
            id,
            appName: session.appName,
            userId: session.userId,
            state: {},
            events: [],
            lastUpdateTime: session.lastUpdateTime,
          });
        }
      }
    }

    return { sessions };
  }

  /**
   * Elimina una sesión
   */
  async deleteSession({ sessionId }: DeleteSessionRequest): Promise<void> {
    if (this.supabase.isEnabled()) {
      try {
        await this.supabase.query(
          `DELETE FROM adk_sessions WHERE session_id = $1`,
          [sessionId],
        );
        this.logger.debug(`Sesión eliminada de Supabase: ${sessionId}`);
      } catch (error) {
        this.logger.error(
          `Error eliminando sesión de Supabase: ${(error as Error).message}`,
        );
      }
    }

    this.fallbackSessions.delete(sessionId);
  }

  /**
   * Agrega un evento a la sesión y actualiza el estado.
   * Implementa el método requerido por BaseSessionService de ADK.
   */
  async appendEvent({ session, event }: AppendEventRequest): Promise<Event> {
    // Deja que la clase base aplique stateDelta (ignorando temp:) y agregue el evento
    await super.appendEvent({ session, event });
    session.lastUpdateTime = event.timestamp;

    // Defensa extra: si la sesión ya traía claves temp: (p.ej. datos legacy),
    // no dejarlas persistirse ni devolverse.
    session.state = this.stripTempState(session.state);

    // Persistir cambios
    if (this.supabase.isEnabled()) {
      try {
        await this.supabase.query(
          `UPDATE adk_sessions 
           SET events = $1::jsonb, state = $2::jsonb, last_update_time = NOW()
           WHERE session_id = $3`,
          [
            JSON.stringify(session.events),
            JSON.stringify(session.state),
            session.id,
          ],
        );
      } catch (error) {
        this.logger.error(
          `Error actualizando sesión en Supabase: ${(error as Error).message}`,
        );
      }
    }

    // Actualizar en memoria
    this.fallbackSessions.set(session.id, session);

    return event;
  }

  private applyGetConfig(
    session: Session,
    config?: GetSessionRequest['config'],
  ): Session {
    if (!config) return session;

    const copied: Session = {
      ...session,
      state: { ...session.state },
      events: [...session.events],
    };

    if (config.numRecentEvents) {
      copied.events = copied.events.slice(-config.numRecentEvents);
    }

    if (config.afterTimestamp) {
      let i = copied.events.length - 1;
      while (i >= 0) {
        if (copied.events[i].timestamp < config.afterTimestamp) {
          break;
        }
        i--;
      }
      if (i >= 0) {
        copied.events = copied.events.slice(i + 1);
      }
    }

    return copied;
  }

  /**
   * Convierte una fila de base de datos a un objeto Session
   */
  private rowToSession(row: AdkSessionRow): Session {
    return {
      id: row.session_id,
      appName: row.app_name,
      userId: row.user_id,
      events: this.parseJson(row.events, []) as Event[],
      state: this.stripTempState(
        this.parseJson(row.state, {}) as Record<string, unknown>,
      ),
      lastUpdateTime: new Date(row.last_update_time).getTime(),
    };
  }

  private stripTempState(
    state: Record<string, unknown>,
  ): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(state)) {
      if (key.startsWith('temp:')) continue;
      cleaned[key] = value;
    }
    return cleaned;
  }

  /**
   * Parsea JSON de forma segura
   */
  private parseJson<T>(value: unknown, fallback: T): T {
    if (!value) return fallback;

    if (typeof value === 'object') {
      return value as T;
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as T;
      } catch {
        return fallback;
      }
    }

    return fallback;
  }
}
