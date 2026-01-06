import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../services/supabase.service';
import { GroupCreationService } from '../../frontend-creation/group-creation.service';
import { WhatsAppMessagingService } from '../services/whatsapp-messaging.service';
import type { RouterAction } from '../whatsapp.types';
import { randomUUID } from 'node:crypto';

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
    private readonly groupCreation: GroupCreationService,
    private readonly messaging: WhatsAppMessagingService,
  ) {}

  async handleCreateGroup(params: {
    phoneNumberId?: string;
    sender: string;
    payload: CreateGroupPayload;
  }): Promise<RouterAction[]> {
    const subject =
      params.payload.subject || `PasaTanda ${new Date().getMonth() + 1}`;
    const invitedPhones = Array.from(new Set(params.payload.participants ?? []))
      .filter(Boolean)
      .filter((phone) => phone !== params.sender);

    // Crear usuario + membresía y grupo draft en base de datos
    const user = await this.groupCreation.upsertUser({
      phone: params.sender,
      username: params.sender,
      preferredCurrency: 'USD',
    });

    const draftGroup = await this.groupCreation.createDraftGroup({
      name: subject,
      amount: params.payload.amountUsd ?? 1,
      frequencyDays: params.payload.frequencyDays ?? 7,
      yieldEnabled: params.payload.yieldEnabled ?? true,
    });

    await this.groupCreation.createMembership({
      userId: user.userId,
      groupDbId: draftGroup.groupDbId,
      isAdmin: true,
      turnNumber: 1,
    });

    // Crear invitaciones y enviar mensajes a cada participante.
    const invitationsSent = await Promise.all(
      invitedPhones.map(async (invitedPhone) => {
        const inviteCode = await this.createInvitationCodeWithRetry({
          groupDbId: draftGroup.groupDbId,
          inviterPhone: params.sender,
          invitedPhone,
        });

        await this.messaging.sendText(
          invitedPhone,
          `📩 Te invitaron a unirte a la tanda "${subject}".\n\nPara aceptar responde: ACEPTAR ${inviteCode}\nPara rechazar responde: RECHAZAR ${inviteCode}`,
          { phoneNumberId: params.phoneNumberId },
        );

        return inviteCode;
      }),
    );

    return [
      {
        type: 'text',
        text: `Grupo creado: ${subject}\nEstado: DRAFT\nInvitaciones enviadas: ${invitationsSent.length}\nContrato: pendiente (usa "iniciar tanda" cuando esté listo)`,
      },
    ];
  }

  private async createInvitationCodeWithRetry(params: {
    groupDbId: number;
    inviterPhone: string;
    invitedPhone: string;
  }): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const inviteCode = randomUUID()
        .replace(/-/g, '')
        .slice(0, 8)
        .toUpperCase();
      const rows = await this.supabase.query<{ id: number }>(
        `
          insert into group_invitations (group_id, inviter_phone, invited_phone, invite_code, status)
          values ($1, $2, $3, $4, 'PENDING')
          on conflict (invite_code) do nothing
          returning id
        `,
        [
          params.groupDbId,
          params.inviterPhone,
          params.invitedPhone,
          inviteCode,
        ],
      );

      if (rows.length) {
        return inviteCode;
      }
    }

    throw new Error('No se pudo generar un código de invitación único.');
  }

  async handleStartTanda(params: {
    sender: string;
    groupId?: string;
    amountUsd?: number;
    amountBs?: number;
    frequencyDays?: number;
    yieldEnabled?: boolean;
  }): Promise<RouterAction[]> {
    const groupId = params.groupId;
    if (!groupId) {
      return [
        {
          type: 'text',
          text: 'No tengo el ID del grupo. Envíame el comando dentro del grupo para detectarlo automáticamente.',
        },
      ];
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
      return [
        {
          type: 'text',
          text: 'No encontré el grupo en base de datos. Crea la tanda primero desde el formulario.',
        },
      ];
    }

    if (group.contract_address) {
      return [
        {
          type: 'text',
          text: `La tanda ya está activa. Contrato: ${group.contract_address}`,
        },
      ];
    }

    if (group.admin_phone !== params.sender) {
      return [
        {
          type: 'text',
          text: 'Solo el admin que creó la tanda puede iniciarla.',
        },
      ];
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
      return [
        {
          type: 'text',
          text: 'Faltan montos para iniciar la tanda. Define amountBs y amountUsdc en el comando o vuelve a crear desde el FE.',
        },
      ];
    }

    return [
      {
        type: 'text',
        text: 'Inicio de tanda aún no está disponible en esta versión del agente.',
      },
    ];
  }
  async handleCheckStatus(params: {
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

    const rows = await this.supabase.query<{
      name: string;
      status: string;
      contract_address: string | null;
      frequency_days: number | null;
      yield_enabled: boolean | null;
    }>(
      'SELECT name, status, contract_address, frequency_days, yield_enabled FROM groups WHERE group_whatsapp_id = $1 OR id::text = $1 LIMIT 1',
      [params.groupId],
    );

    if (!rows.length) {
      return [
        {
          type: 'text',
          text: 'No encontré ese grupo en la base de datos. Revisa el ID o vuelve a crearlo.',
        },
      ];
    }

    const group = rows[0];
    return [
      {
        type: 'text',
        text: `Estado del grupo ${group.name}\n- Estado: ${group.status}\n- Contrato: ${group.contract_address ?? 'n/d'}\n- Frecuencia: ${group.frequency_days} días\n- Rendimiento: ${group.yield_enabled ? 'activo' : 'desactivado'}`,
      },
    ];
  }
}
