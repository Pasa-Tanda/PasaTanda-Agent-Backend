import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../services/supabase.service';
import { GroupService } from '../services/group.service';
import type { RouterAction, TenantContext } from '../whatsapp.types';

interface CreateGroupPayload {
  subject: string;
  participants: string[];
  amountUsd?: number;
  frequencyDays?: number;
  yieldEnabled?: boolean;
}

@Injectable()
export class GameMasterAgentService {
  private readonly logger = new Logger(GameMasterAgentService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly groupService: GroupService,
  ) {}

  async handleCreateGroup(params: {
    tenant: TenantContext;
    sender: string;
    payload: CreateGroupPayload;
  }): Promise<RouterAction[]> {
    const subject = params.payload.subject || `PasaTanda ${new Date().getMonth() + 1}`;
    const participants = Array.from(new Set([params.sender, ...params.payload.participants])).filter(Boolean);

    // Crear grupo en WhatsApp
    const groupResult = await this.groupService.createGroup(
      params.tenant.phoneNumberId,
      { subject, participants },
    );

    // Persistir en Supabase sin contrato (DRAFT)
    await this.supabase.query(
      `INSERT INTO groups (group_whatsapp_id, name, contract_address, total_cycle_amount_usdc, frequency_days, yield_enabled, status)
       VALUES ($1, $2, NULL, $3, $4, $5, 'DRAFT')
       ON CONFLICT (group_whatsapp_id) DO UPDATE SET name = EXCLUDED.name` as string,
      [groupResult.id ?? null, subject, params.payload.amountUsd ?? 1, params.payload.frequencyDays ?? 7, params.payload.yieldEnabled ?? true],
    );

    return [
      {
        type: 'text',
        text: `Grupo creado: ${subject}\nWA Group: ${groupResult.id ?? 'pendiente'}\nContrato: pendiente (usa "iniciar tanda" cuando esté listo)`,
      },
    ];
    }

  async handleStartTanda(params: {
    tenant: TenantContext;
    sender: string;
    groupId?: string;
    amountUsd?: number;
    amountBs?: number;
    frequencyDays?: number;
    yieldEnabled?: boolean;
  }): Promise<RouterAction[]> {
    const groupId = params.groupId;
    if (!groupId) {
      return [{ type: 'text', text: 'No tengo el ID del grupo. Envíame el comando dentro del grupo para detectarlo automáticamente.' }];
    }

    const rows = await this.supabase.query<{
      id: number;
      name: string;
      group_whatsapp_id: string | null;
      contract_address: string | null;
      frequency_days: number | null;
      yield_enabled: boolean | null;
      status: string;
      admin_phone: string;
    }>(
      `SELECT g.id, g.name, g.group_whatsapp_id, g.contract_address, g.frequency_days, g.yield_enabled, g.status,
              u.phone_number as admin_phone
       FROM groups g
       JOIN memberships m ON m.group_id = g.id AND m.is_admin = true
       JOIN users u ON u.id = m.user_id
       WHERE g.group_whatsapp_id = $1 OR g.id::text = $1
       LIMIT 1` as string,
      [groupId],
    );

    const group = rows[0];
    if (!group) {
      return [{ type: 'text', text: 'No encontré el grupo en base de datos. Crea la tanda primero desde el formulario.' }];
    }

    if (group.contract_address) {
      return [{ type: 'text', text: `La tanda ya está activa. Contrato: ${group.contract_address}` }];
    }

    if (group.admin_phone !== params.sender) {
      return [{ type: 'text', text: 'Solo el admin que creó la tanda puede iniciarla.' }];
    }

    const draftOrder = await this.supabase.query<{
      amount_fiat: number;
      amount_crypto_usdc: number;
    }>(
      `SELECT amount_fiat, amount_crypto_usdc
       FROM payment_orders
       WHERE group_id = $1 AND status = 'DRAFT'
       ORDER BY created_at DESC
       LIMIT 1` as string,
      [group.id],
    );

    const amountBs = params.amountBs ?? draftOrder[0]?.amount_fiat;
    const amountUsd = params.amountUsd ?? draftOrder[0]?.amount_crypto_usdc;

    if (!amountBs || !amountUsd) {
      return [{ type: 'text', text: 'Faltan montos para iniciar la tanda. Define amountBs y amountUsdc en el comando o vuelve a crear desde el FE.' }];
    }

    return [
      {
        type: 'text',
        text: 'Inicio de tanda aún no está disponible en esta versión del agente.',
      },
    ];
  }
  async handleCheckStatus(params: {
    tenant: TenantContext;
    groupId?: string;
  }): Promise<RouterAction[]> {
    if (!params.groupId) {
      return [
        {
          type: 'text',
          text: 'Necesito el identificador del grupo o el enlace para mostrar el estado.',
        },
      ];
    }

    const rows = await this.supabase.query(
      'SELECT name, status, contract_address, frequency_days, yield_enabled FROM groups WHERE group_whatsapp_id = $1 OR id::text = $1 LIMIT 1',
      [params.groupId],
    );

    if (!rows.length) {
      return [
        { type: 'text', text: 'No encontré ese grupo en la base de datos. Revisa el ID o vuelve a crearlo.' },
      ];
    }

    const group = rows[0] as any;
    return [
      {
        type: 'text',
        text: `Estado del grupo ${group.name}\n- Estado: ${group.status}\n- Contrato: ${group.contract_address ?? 'n/d'}\n- Frecuencia: ${group.frequency_days} días\n- Rendimiento: ${group.yield_enabled ? 'activo' : 'desactivado'}`,
      },
    ];
  }
}
