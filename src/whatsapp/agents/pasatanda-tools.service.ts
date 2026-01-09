import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FunctionTool, ToolContext } from '@google/adk';
import { z } from 'zod';
import { SupabaseService } from '../services/supabase.service';
import { GroupCreationService } from '../../frontend-creation/group-creation.service';
import { PaymentIntegrationService } from '../services/payment-integration.service';
import { VerificationService } from '../services/verification.service';
import { SorobanClientService } from '../services/soroban-client.service';
import {
  WhatsAppMessagingService,
  type WhatsAppInteractiveButton,
  type WhatsAppInteractiveListSection,
} from '../services/whatsapp-messaging.service';
import { randomUUID } from 'node:crypto';

/**
 * Servicio que provee todas las herramientas (tools) para los agentes ADK de PasaTanda.
 * Estas tools son funciones que los agentes LLM pueden invocar para realizar acciones.
 */
@Injectable()
export class PasatandaToolsService {
  private readonly logger = new Logger(PasatandaToolsService.name);
  private readonly paymentPage: string;
  private readonly phoneNumberId: string;
  private readonly groupCreatedStickerUrl: string;
  private readonly groupCreatedImageStellarUrl: string;
  private readonly welcomeStickerUrl: string;
  private readonly verificationStickerUrl: string;
  private readonly invitationImageUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
    private readonly groupCreation: GroupCreationService,
    private readonly payments: PaymentIntegrationService,
    private readonly verification: VerificationService,
    private readonly soroban: SorobanClientService,
    private readonly messaging: WhatsAppMessagingService,
  ) {
    this.paymentPage = this.config.get<string>('MAIN_PAGE_URL', '');
    this.phoneNumberId =
      this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID', '') ||
      this.config.get<string>('PHONE_NUMBER_ID', '');
    this.groupCreatedStickerUrl = this.config.get<string>(
      'WHATSAPP_STICKER_GROUP_CREATED',
      '',
    );
    this.welcomeStickerUrl = this.config.get<string>(
      'WHATSAPP_STICKER_WELCOME',
      '',
    );
    this.verificationStickerUrl = this.config.get<string>(
      'WHATSAPP_STICKER_VERIFICATION',
      '',
    );
    this.invitationImageUrl = this.config.get<string>(
      'WHATSAPP_IMAGE_INVITATION',
      '',
    );
    this.groupCreatedImageStellarUrl = this.config.get<string>(
      'WHATSAPP_IMAGE_GROUP_CREATED_STELLAR',
      '',
    );
  }

  // =========================================================================
  // TOOL: Crear grupo PasaTanda (draft)
  // =========================================================================
  get createGroupTool(): FunctionTool {
    return new FunctionTool({
      name: 'create_pasatanda_group',
      description: `Crea un nuevo grupo de tanda en estado DRAFT. 
        El grupo se crea en la base de datos y se envían invitaciones por WhatsApp a los participantes.
        El usuario que crea el grupo se convierte en administrador.
        Usa esta herramienta cuando el usuario quiera crear una nueva tanda.`,
      parameters: z.object({
        senderPhone: z
          .string()
          .describe('Número de teléfono del creador del grupo'),
        groupName: z.string().optional().describe('Nombre del grupo de tanda'),
        participants: z
          .array(z.string())
          .optional()
          .describe('Lista de números de teléfono de participantes'),
        amountUsd: z.number().optional().describe('Monto en USD de cada cuota'),
        frequencyDays: z
          .number()
          .optional()
          .describe('Frecuencia de turnos en días'),
        yieldEnabled: z
          .boolean()
          .optional()
          .describe('Si el rendimiento está habilitado'),
      }),
      execute: async (args, toolContext?: ToolContext) => {
        try {
          const senderPhone = this.normalizePhone(args.senderPhone);
          const subject =
            args.groupName || `PasaTanda ${new Date().getMonth() + 1}`;
          const invitedPhones = Array.from(
            new Set(
              (args.participants ?? [])
                .map((p) => this.normalizePhone(p))
                .filter(Boolean),
            ),
          )
            .filter(Boolean)
            .filter((phone) => phone !== senderPhone);

          // Crear usuario en base de datos
          const user = await this.groupCreation.upsertUser({
            phone: senderPhone,
            username: senderPhone,
            preferredCurrency: 'USD',
          });

          // Crear grupo en base de datos
          const draftGroup = await this.groupCreation.createDraftGroup({
            name: subject,
            amount: args.amountUsd ?? 1,
            frequencyDays: args.frequencyDays ?? 7,
            yieldEnabled: args.yieldEnabled ?? true,
          });

          // Crear membresía del admin
          await this.groupCreation.createMembership({
            userId: user.userId,
            groupDbId: draftGroup.groupDbId,
            isAdmin: true,
            turnNumber: 1,
          });

          if (toolContext) {
            toolContext.state['user:selected_group_id'] = draftGroup.groupDbId;
            toolContext.state['user:selected_group_name'] = subject;
            toolContext.state['user:preferred_currency'] = 'USD';
            toolContext.state['user:phone'] = senderPhone;
          }

          const invitations = await Promise.all(
            invitedPhones.map(async (invitedPhone) => {
              const inviteCode = await this.createInvitationCodeWithRetry({
                groupDbId: draftGroup.groupDbId,
                inviterPhone: senderPhone,
                invitedPhone,
              });

              if (this.phoneNumberId) {
                await this.sendInvitationMessage({
                  to: invitedPhone,
                  groupName: subject,
                  inviteCode,
                });
              }

              return { invitedPhone, inviteCode };
            }),
          );

          if (this.groupCreatedStickerUrl) {
            await this.messaging.sendSticker(
              senderPhone,
              { link: this.groupCreatedStickerUrl },
              { phoneNumberId: this.phoneNumberId },
            );
          }

          return {
            status: 'success',
            groupName: subject,
            groupDbId: draftGroup.groupDbId,
            invitations,
            message: `Grupo "${subject}" creado exitosamente. Estado: DRAFT. Envié ${invitations.length} invitaciones.`,
          };
        } catch (error) {
          this.logger.error(`Error creando grupo: ${(error as Error).message}`);
          return {
            status: 'error',
            error: (error as Error).message,
          };
        }
      },
    });
  }

  // =========================================================================
  // TOOL: Seleccionar tanda (admin) vía lista interactiva
  // =========================================================================
  get selectAdminGroupTool(): FunctionTool {
    return new FunctionTool({
      name: 'select_admin_group',
      description: `Envía una lista interactiva con las tandas donde el usuario es administrador.
        Úsala cuando falte groupId o cuando necesites que el usuario seleccione una tanda.`,
      parameters: z.object({
        senderPhone: z
          .string()
          .optional()
          .describe('Teléfono del usuario que debe seleccionar la tanda'),
        purpose: z
          .enum([
            'CONFIGURE_TANDA',
            'CHECK_STATUS',
            'ADD_PARTICIPANT',
            'START_TANDA',
          ])
          .optional()
          .describe(
            'Propósito de la selección. Si se omite, se infiere desde user:pending_action si existe.',
          ),
      }),
      execute: async (args, toolContext?: ToolContext) => {
        const senderPhoneRaw =
          args.senderPhone ??
          (toolContext?.state?.['user:phone'] as string | undefined);
        const senderPhone = senderPhoneRaw
          ? this.normalizePhone(senderPhoneRaw)
          : undefined;
        if (!senderPhone) {
          return {
            status: 'error',
            error:
              'Falta senderPhone para mostrar la lista de tandas administradas.',
          };
        }

        const pendingAction = toolContext?.state?.['user:pending_action'] as
          | string
          | undefined;

        const inferredPurpose:
          | 'CONFIGURE_TANDA'
          | 'CHECK_STATUS'
          | 'ADD_PARTICIPANT'
          | 'START_TANDA'
          | undefined =
          args.purpose ??
          (pendingAction === 'configure_tanda'
            ? 'CONFIGURE_TANDA'
            : pendingAction === 'add_participant'
              ? 'ADD_PARTICIPANT'
              : pendingAction === 'start_tanda'
                ? 'START_TANDA'
                : pendingAction
                  ? 'CHECK_STATUS'
                  : undefined);

        const purpose = inferredPurpose ?? 'CHECK_STATUS';
        await this.sendAdminGroupSelectionList({ to: senderPhone, purpose });

        return {
          status: 'sent',
          message: 'Te envié una lista con tus tandas (admin).',
          purpose,
        };
      },
    });
  }

  // =========================================================================
  // TOOL: Agregar participante a grupo
  // =========================================================================
  get addParticipantTool(): FunctionTool {
    return new FunctionTool({
      name: 'add_participant_to_group',
      description: `Agrega un nuevo participante a un grupo de tanda existente.
        Envía una invitación por WhatsApp para que el usuario acepte y se una a la tanda.`,
      parameters: z.object({
        senderPhone: z
          .string()
          .optional()
          .describe(
            'Teléfono del usuario que solicita agregar al participante',
          ),
        groupId: z
          .string()
          .optional()
          .describe(
            'ID del grupo (puede ser el ID de base de datos o WhatsApp). Si no se especifica, se enviará una lista de tandas administradas para seleccionar.',
          ),
        participantPhone: z
          .string()
          .optional()
          .describe('Número de teléfono del nuevo participante'),
        participantName: z
          .string()
          .optional()
          .describe('Nombre del participante'),
      }),
      execute: async (args, toolContext?: ToolContext) => {
        try {
          const senderPhoneRaw =
            args.senderPhone ??
            (toolContext?.state?.['user:phone'] as string | undefined);
          const senderPhone = senderPhoneRaw
            ? this.normalizePhone(senderPhoneRaw)
            : undefined;
          if (!senderPhone) {
            return {
              status: 'error',
              error:
                'Falta senderPhone para determinar tus tandas administradas.',
            };
          }

          const participantPhoneRaw =
            args.participantPhone ??
            (toolContext?.state?.['user:pending_participant_phone'] as
              | string
              | undefined);
          const participantPhone = participantPhoneRaw
            ? this.normalizePhone(participantPhoneRaw)
            : undefined;

          if (!args.groupId) {
            if (toolContext && participantPhone) {
              toolContext.state['user:pending_participant_phone'] =
                participantPhone;
              if (args.participantName) {
                toolContext.state['user:pending_participant_name'] =
                  args.participantName;
              }
              toolContext.state['user:pending_action'] = 'add_participant';
            }
            return {
              status: 'needs_group_selection',
              message:
                'Necesito que selecciones una tanda. Llama select_admin_group para mostrar la lista.',
            };
          }

          if (!participantPhone) {
            return {
              status: 'error',
              error: 'Falta participantPhone para enviar la invitación.',
            };
          }

          const resolvedGroupId = this.parseGroupId(args.groupId);

          // Buscar el grupo
          const groups = await this.supabase.query<{
            id: number;
            name: string;
            group_whatsapp_id: string | null;
          }>(
            `SELECT id, name, group_whatsapp_id 
             FROM groups 
             WHERE group_whatsapp_id = $1 OR id::text = $1
             LIMIT 1`,
            [resolvedGroupId],
          );

          if (!groups.length) {
            return { status: 'error', error: 'Grupo no encontrado' };
          }

          const group = groups[0];

          const inviterPhone =
            (toolContext?.state?.['user:phone'] as string | undefined) ??
            'system';
          const inviteCode = await this.createInvitationCodeWithRetry({
            groupDbId: group.id,
            inviterPhone: this.normalizePhone(inviterPhone),
            invitedPhone: participantPhone,
          });

          if (this.phoneNumberId) {
            await this.sendInvitationMessage({
              to: participantPhone,
              groupName: group.name,
              inviteCode,
            });
          }

          if (toolContext) {
            toolContext.state['user:selected_group_id'] = group.id;
            toolContext.state['user:selected_group_name'] = group.name;
          }

          return {
            status: 'success',
            inviteCode,
            message: `Invitación enviada a ${participantPhone} para unirse a "${group.name}".`,
          };
        } catch (error) {
          this.logger.error(
            `Error agregando participante: ${(error as Error).message}`,
          );
          return { status: 'error', error: (error as Error).message };
        }
      },
    });
  }

  // =========================================================================
  // TOOL: Configurar tanda
  // =========================================================================
  get configureGroupTool(): FunctionTool {
    return new FunctionTool({
      name: 'configure_tanda',
      description: `Configura los valores de una tanda existente.
        Permite cambiar el monto, frecuencia y opciones de rendimiento.`,
      parameters: z.object({
        senderPhone: z
          .string()
          .optional()
          .describe('Teléfono del usuario que solicita la configuración'),
        groupId: z
          .string()
          .optional()
          .describe(
            'ID del grupo. Si no se especifica, se enviará una lista de tandas administradas para seleccionar.',
          ),
        amountUsd: z
          .number()
          .optional()
          .describe('Nuevo monto en USD por cuota'),
        amountFiat: z
          .number()
          .optional()
          .describe('Monto en moneda local (Bs)'),
        frequencyDays: z
          .number()
          .optional()
          .describe('Nueva frecuencia en días'),
        yieldEnabled: z
          .boolean()
          .optional()
          .describe('Habilitar/deshabilitar rendimiento'),
      }),
      execute: async (args, toolContext?: ToolContext) => {
        try {
          const senderPhoneRaw =
            args.senderPhone ??
            (toolContext?.state?.['user:phone'] as string | undefined);
          const senderPhone = senderPhoneRaw
            ? this.normalizePhone(senderPhoneRaw)
            : undefined;
          if (!senderPhone) {
            return {
              status: 'error',
              error:
                'Falta senderPhone para determinar tus tandas administradas.',
            };
          }

          if (!args.groupId) {
            if (toolContext) {
              toolContext.state['user:pending_configure'] = {
                amountUsd: args.amountUsd,
                frequencyDays: args.frequencyDays,
                yieldEnabled: args.yieldEnabled,
              };
              toolContext.state['user:pending_action'] = 'configure_tanda';
            }
            return {
              status: 'needs_group_selection',
              message:
                'Necesito que selecciones una tanda. Llama select_admin_group para mostrar la lista.',
            };
          }

          const resolvedGroupId = this.parseGroupId(args.groupId);

          const groups = await this.supabase.query<{
            id: number;
            name: string;
          }>(
            `SELECT id, name
             FROM groups
             WHERE group_whatsapp_id = $1 OR id::text = $1
             LIMIT 1`,
            [resolvedGroupId],
          );

          if (!groups.length) {
            return { status: 'error', error: 'Grupo no encontrado' };
          }

          const group = groups[0];

          const pending = toolContext?.state?.['user:pending_configure'] as
            | {
                amountUsd?: number;
                frequencyDays?: number;
                yieldEnabled?: boolean;
              }
            | undefined;

          const amountUsd = args.amountUsd ?? pending?.amountUsd;
          const frequencyDays = args.frequencyDays ?? pending?.frequencyDays;
          const yieldEnabled = args.yieldEnabled ?? pending?.yieldEnabled;

          const updates: string[] = [];
          const values: unknown[] = [];
          let paramIndex = 1;

          if (amountUsd !== undefined) {
            updates.push(`total_cycle_amount_usdc = $${paramIndex++}`);
            values.push(amountUsd);
          }
          if (frequencyDays !== undefined) {
            updates.push(`frequency_days = $${paramIndex++}`);
            values.push(frequencyDays);
          }
          if (yieldEnabled !== undefined) {
            updates.push(`yield_enabled = $${paramIndex++}`);
            values.push(yieldEnabled);
          }

          if (updates.length === 0) {
            return {
              status: 'no_changes',
              message: 'No se especificaron cambios',
            };
          }

          values.push(resolvedGroupId);

          await this.supabase.query(
            `UPDATE groups SET ${updates.join(', ')} 
             WHERE group_whatsapp_id = $${paramIndex} OR id::text = $${paramIndex}`,
            values,
          );

          if (toolContext) {
            toolContext.state['user:selected_group_id'] = group.id;
            toolContext.state['user:selected_group_name'] = group.name;
            toolContext.state['user:pending_configure'] = undefined;
            toolContext.state['user:pending_action'] = undefined;
          }

          return {
            status: 'success',
            message: 'Configuración de la tanda actualizada',
            changes: {
              amountUsd,
              frequencyDays,
              yieldEnabled,
            },
          };
        } catch (error) {
          this.logger.error(
            `Error configurando tanda: ${(error as Error).message}`,
          );
          return { status: 'error', error: (error as Error).message };
        }
      },
    });
  }

  // =========================================================================
  // TOOL: Consultar estado del grupo
  // =========================================================================
  get checkGroupStatusTool(): FunctionTool {
    return new FunctionTool({
      name: 'check_group_status',
      description: `Consulta el estado actual de un grupo de tanda.
        Devuelve información sobre el grupo, miembros, pagos pendientes y próximo turno.`,
      parameters: z.object({
        senderPhone: z
          .string()
          .optional()
          .describe('Teléfono del usuario que solicita el estado'),
        groupId: z
          .string()
          .optional()
          .describe(
            'ID del grupo. Si no se especifica, se enviará una lista de tandas administradas para seleccionar.',
          ),
      }),
      execute: async (args, toolContext?: ToolContext) => {
        try {
          const senderPhoneRaw =
            args.senderPhone ??
            (toolContext?.state?.['user:phone'] as string | undefined);
          const senderPhone = senderPhoneRaw
            ? this.normalizePhone(senderPhoneRaw)
            : undefined;
          if (!senderPhone) {
            return {
              status: 'error',
              error:
                'Falta senderPhone para determinar tus tandas administradas.',
            };
          }

          if (!args.groupId) {
            return {
              status: 'needs_group_selection',
              message:
                'Necesito que selecciones una tanda. Llama select_admin_group para mostrar la lista.',
            };
          }

          const resolvedGroupId = this.parseGroupId(args.groupId);

          const groups = await this.supabase.query<{
            id: number;
            name: string;
            status: string;
            contract_address: string | null;
            frequency_days: number;
            yield_enabled: boolean;
            total_cycle_amount_usdc: number | null;
          }>(
            `SELECT id, name, status, contract_address, frequency_days, yield_enabled, total_cycle_amount_usdc
             FROM groups
             WHERE group_whatsapp_id = $1 OR id::text = $1
             LIMIT 1`,
            [resolvedGroupId],
          );

          if (!groups.length) {
            return { status: 'not_found', message: 'Grupo no encontrado' };
          }

          const group = groups[0];

          if (toolContext) {
            toolContext.state['user:selected_group_id'] = group.id;
            toolContext.state['user:selected_group_name'] = group.name;
          }

          // Obtener miembros
          const members = await this.supabase.query<{
            phone_number: string;
            username: string;
            is_admin: boolean;
            turn_number: number;
          }>(
            `SELECT u.phone_number, u.username, m.is_admin, m.turn_number
             FROM memberships m
             JOIN users u ON u.id = m.user_id
             WHERE m.group_id = $1
             ORDER BY m.turn_number`,
            [group.id],
          );

          return {
            status: 'success',
            group: {
              name: group.name,
              status: group.status,
              contractAddress: group.contract_address,
              frequencyDays: group.frequency_days,
              yieldEnabled: group.yield_enabled,
              amountUsd: group.total_cycle_amount_usdc,
              memberCount: members.length,
            },
            members: members.map((m) => ({
              phone: m.phone_number,
              name: m.username,
              isAdmin: m.is_admin,
              turnNumber: m.turn_number,
            })),
          };
        } catch (error) {
          this.logger.error(
            `Error consultando estado: ${(error as Error).message}`,
          );
          return { status: 'error', error: (error as Error).message };
        }
      },
    });
  }

  // =========================================================================
  // TOOL: Iniciar tanda (admin) — despliega contrato Soroban
  // =========================================================================
  get startTandaTool(): FunctionTool {
    return new FunctionTool({
      name: 'start_tanda',
      description:
        'Inicia una tanda en estado DRAFT: valida admin, despliega contrato en Soroban y marca el grupo como ACTIVE.',
      parameters: z.object({
        senderPhone: z
          .string()
          .optional()
          .describe('Teléfono del admin que inicia la tanda'),
        groupId: z
          .string()
          .optional()
          .describe(
            'ID del grupo. Si no se especifica, se debe pedir selección con select_admin_group.',
          ),
      }),
      execute: async (args, toolContext?: ToolContext) => {
        try {
          const senderPhoneRaw =
            args.senderPhone ??
            (toolContext?.state?.['user:phone'] as string | undefined);
          const senderPhone = senderPhoneRaw
            ? this.normalizePhone(senderPhoneRaw)
            : undefined;
          if (!senderPhone) {
            return {
              status: 'error',
              error:
                'Falta senderPhone para validar permisos e iniciar la tanda.',
            };
          }

          if (!args.groupId) {
            if (toolContext) {
              toolContext.state['user:pending_action'] = 'start_tanda';
            }
            return {
              status: 'needs_group_selection',
              message:
                'Necesito que selecciones una tanda. Llama select_admin_group para mostrar la lista.',
            };
          }

          const resolvedGroupId = this.parseGroupId(args.groupId);

          const groups = await this.supabase.query<{
            id: number;
            name: string;
            status: string;
            contract_address: string | null;
            total_cycle_amount_usdc: number | null;
            frequency_days: number;
            yield_enabled: boolean;
          }>(
            `SELECT id, name, status, contract_address, total_cycle_amount_usdc, frequency_days, yield_enabled
             FROM groups
             WHERE group_whatsapp_id = $1 OR id::text = $1
             LIMIT 1`,
            [resolvedGroupId],
          );

          if (!groups.length) {
            return { status: 'error', error: 'Grupo no encontrado' };
          }

          const group = groups[0];
          if (group.contract_address) {
            return {
              status: 'already_started',
              message: `La tanda "${group.name}" ya tiene contrato: ${group.contract_address}.`,
            };
          }

          if (group.status !== 'DRAFT') {
            return {
              status: 'error',
              error: `La tanda debe estar en estado DRAFT para iniciarse (estado actual: ${group.status}).`,
            };
          }

          const users = await this.supabase.query<{
            id: string;
            phone_number: string;
            stellar_public_key: string | null;
          }>(
            `SELECT id, phone_number, stellar_public_key
             FROM users
             WHERE phone_number = $1 OR phone_number like $2
             LIMIT 1`,
            [senderPhone, `%${senderPhone.slice(-10)}`],
          );

          const user = users[0];
          if (!user?.id) {
            return {
              status: 'error',
              error: 'No encontré tu usuario. Regístrate primero.',
            };
          }

          const adminMembership = await this.supabase.query<{
            is_admin: boolean;
          }>(
            `SELECT is_admin
             FROM memberships
             WHERE user_id = $1 AND group_id = $2
             LIMIT 1`,
            [user.id, group.id],
          );

          if (!adminMembership[0]?.is_admin) {
            return {
              status: 'forbidden',
              error: 'Solo un administrador puede iniciar la tanda.',
            };
          }

          const members = await this.supabase.query<{
            stellar_public_key: string | null;
            turn_number: number;
          }>(
            `SELECT u.stellar_public_key, m.turn_number
             FROM memberships m
             JOIN users u ON u.id = m.user_id
             WHERE m.group_id = $1
             ORDER BY m.turn_number`,
            [group.id],
          );

          const memberKeys = members
            .map((m) => m.stellar_public_key)
            .filter((k): k is string => Boolean(k));

          if (memberKeys.length !== members.length) {
            return {
              status: 'error',
              error:
                'Faltan wallets Stellar (stellar_public_key) en uno o más miembros. Todos deben tener wallet antes de iniciar.',
            };
          }

          const adminKey = user.stellar_public_key;
          if (!adminKey) {
            return {
              status: 'error',
              error:
                'No tienes wallet Stellar registrada. Crea/conecta tu wallet antes de iniciar la tanda.',
            };
          }

          // AmountPerRound en stroops (USDC 7 decimales) — aquí asumimos 1 USD == 1 USDC.
          // Si el backend espera otra precisión/asset, ajustar en Soroban BE.
          const amountUsd = Number(group.total_cycle_amount_usdc ?? 0);
          if (!amountUsd) {
            return {
              status: 'error',
              error:
                'La tanda no tiene monto configurado. Define total_cycle_amount_usdc.',
            };
          }

          const amountStroops = String(Math.round(amountUsd * 10 ** 7));

          const deployment = await this.soroban.createGroup({
            members: memberKeys,
            amountStroops,
            frequencyDays: group.frequency_days,
            enableYield: Boolean(group.yield_enabled),
            yieldShareBps: 7000,
          });

          const contractAddress = deployment.address;
          if (!contractAddress) {
            return {
              status: 'error',
              error:
                'El backend de Soroban no devolvió contract address. Revisa logs del backend de pagos.',
            };
          }

          await this.supabase.query(
            `UPDATE groups
             SET contract_address = $1, status = 'ACTIVE'
             WHERE id = $2`,
            [contractAddress, group.id],
          );

          const stellarExpertUrl = `https://stellar.expert/explorer/testnet/contract/${contractAddress}`;

          // Enviar mensaje interactivo con CTA URL del contrato
          try {
            await this.messaging.sendInteractiveCTA(
              senderPhone,
              `✅ ¡Tanda "${group.name}" iniciada exitosamente!\n\nTu contrato inteligente ha sido desplegado en Soroban. Haz clic en el botón para ver los detalles del contrato en el explorador de Stellar.`,
              stellarExpertUrl,
              'Ver Contrato en Stellar Expert',
              {
                phoneNumberId: this.phoneNumberId,
                header: this.groupCreatedStickerUrl
                  ? {
                      type: 'image',
                      image: { link: this.groupCreatedImageStellarUrl },
                    }
                  : undefined,
                footer: `Contrato: ${contractAddress.substring(0, 16)}...`,
              },
            );
          } catch (msgError) {
            this.logger.warn(
              `No se pudo enviar mensaje CTA de tanda iniciada: ${(msgError as Error).message}`,
            );
          }

          if (toolContext) {
            toolContext.state['user:selected_group_id'] = group.id;
            toolContext.state['user:selected_group_name'] = group.name;
            toolContext.state['user:pending_action'] = undefined;
          }

          return {
            status: 'success',
            groupId: group.id,
            groupName: group.name,
            contractAddress,
            message: `✅ Tanda "${group.name}" iniciada. Contrato: ${contractAddress}.`,
          };
        } catch (error) {
          this.logger.error(
            `Error iniciando tanda: ${(error as Error).message}`,
          );
          return { status: 'error', error: (error as Error).message };
        }
      },
    });
  }

  // =========================================================================
  // TOOL: Crear link de pago
  // =========================================================================
  get createPaymentLinkTool(): FunctionTool {
    return new FunctionTool({
      name: 'create_payment_link',
      description: `Crea un link de pago para una cuota de la tanda.
        Genera un QR code y URL para que el usuario pueda pagar.
        Usa la plantilla "payment_request" de WhatsApp para enviar el link.`,
      parameters: z.object({
        senderPhone: z
          .string()
          .describe('Teléfono del usuario que solicita el pago'),
        amountUsd: z.number().describe('Monto en USD'),
        groupId: z.string().optional().describe('ID del grupo asociado'),
        payTo: z
          .string()
          .optional()
          .describe('Dirección Stellar del destinatario'),
        details: z
          .string()
          .optional()
          .describe('Detalles adicionales del pago'),
      }),
      execute: async (args) => {
        try {
          const orderId = randomUUID();

          // Crear orden de pago en base de datos
          await this.supabase.query(
            `INSERT INTO payment_orders (id, user_id, group_id, amount_crypto_usdc, payment_method, status)
             VALUES ($1, NULL, NULL, $2, 'QR_SIMPLE', 'PENDING')`,
            [orderId, args.amountUsd],
          );

          // Negociar pago con el backend de pagos
          const negotiation = await this.payments.negotiatePayment({
            orderId,
            amountUsd: args.amountUsd,
            payTo: args.payTo,
            description: args.details ?? orderId,
          });

          // Actualizar orden con datos de negociación
          await this.supabase.query(
            `UPDATE payment_orders 
             SET xdr_challenge = $1, qr_payload_url = $2, status = 'CLAIMED_BY_USER' 
             WHERE id = $3`,
            [
              negotiation.challenge ?? null,
              negotiation.qrBase64 ?? null,
              orderId,
            ],
          );

          const payUrl = this.paymentPage
            ? `${this.paymentPage.replace(/\/$/, '')}/pagos/${orderId}`
            : undefined;

          return {
            status: 'success',
            orderId,
            paymentUrl: payUrl,
            qrBase64: negotiation.qrBase64,
            amountUsd: args.amountUsd,
            message: `Link de pago generado: ${payUrl ?? 'Ver QR'}`,
            // Datos para la plantilla payment_request de WhatsApp
            templateData: {
              month: new Date().toLocaleString('es', { month: 'long' }),
              total_amount: `$${args.amountUsd.toFixed(2)} USD`,
              exchange_rate: '1.00', // TODO: Obtener tipo de cambio real
              group_name: args.groupId ?? 'Pago individual',
            },
          };
        } catch (error) {
          this.logger.error(
            `Error creando link de pago: ${(error as Error).message}`,
          );
          return { status: 'error', error: (error as Error).message };
        }
      },
    });
  }

  // =========================================================================
  // TOOL: Verificar comprobante de pago
  // =========================================================================
  get verifyPaymentProofTool(): FunctionTool {
    return new FunctionTool({
      name: 'verify_payment_proof',
      description: `Verifica un comprobante de pago subido por el usuario.
        Extrae información del comprobante (monto, banco, referencia) y lo valida.
        Solo aplica para pagos QR/fiat, los pagos crypto son automáticos.`,
      parameters: z.object({
        orderId: z.string().describe('ID de la orden de pago'),
        imageBase64: z
          .string()
          .optional()
          .describe('Imagen del comprobante en base64'),
        extractedData: z
          .object({
            amount: z.number().optional(),
            bank: z.string().optional(),
            reference: z.string().optional(),
            date: z.string().optional(),
          })
          .optional()
          .describe('Datos extraídos del comprobante'),
      }),
      execute: async (args) => {
        try {
          const rows = await this.supabase.query<{
            amount_crypto_usdc: number;
          }>(
            `SELECT amount_crypto_usdc
             FROM payment_orders
             WHERE id = $1
             LIMIT 1`,
            [args.orderId],
          );
          const amountUsd = Number(rows[0]?.amount_crypto_usdc ?? 0);

          const transactionId = args.extractedData?.reference;
          if (!transactionId) {
            return {
              status: 'error',
              error:
                'No se encontró el transactionId/referencia en el comprobante. Asegúrate de extraer la referencia (transactionId).',
            };
          }

          const verification = await this.payments.verifyFiat({
            orderId: args.orderId,
            amountUsd,
            proofMetadata: {
              glosa: args.orderId,
              time: args.extractedData?.date ?? new Date().toISOString(),
              transactionId: transactionId,
            },
          });

          await this.supabase.query(
            `UPDATE payment_orders 
             SET proof_metadata = $1, status = $2 
             WHERE id = $3`,
            [
              args.extractedData ?? {},
              verification.success ? 'VERIFIED' : 'REJECTED',
              args.orderId,
            ],
          );

          if (verification.success) {
            return {
              status: 'verified',
              message:
                'Pago verificado exitosamente ✅. El turno quedará marcado como pagado.',
            };
          }

          return {
            status: 'rejected',
            message:
              'No pudimos verificar el pago. Revisa los datos del comprobante e inténtalo de nuevo.',
            reason: verification.reason,
          };
        } catch (error) {
          this.logger.error(
            `Error verificando comprobante: ${(error as Error).message}`,
          );
          return { status: 'error', error: (error as Error).message };
        }
      },
    });
  }

  // =========================================================================
  // TOOL: Obtener información de usuario
  // =========================================================================
  get getUserInfoTool(): FunctionTool {
    return new FunctionTool({
      name: 'get_user_info',
      description: `Obtiene información de un usuario por su número de teléfono.
        Incluye sus grupos, pagos pendientes y turnos.`,
      parameters: z.object({
        phone: z.string().describe('Número de teléfono del usuario'),
      }),
      execute: async (args) => {
        try {
          const phone = this.normalizePhone(args.phone);
          const users = await this.supabase.query<{
            id: string;
            phone_number: string;
            username: string;
            stellar_public_key: string | null;
          }>(
            `SELECT id, phone_number, username, stellar_public_key
             FROM users
             WHERE phone_number = $1 OR phone_number LIKE $2
             LIMIT 1`,
            [phone, `%${phone.slice(-10)}`],
          );

          if (!users.length) {
            return { status: 'not_found', message: 'Usuario no encontrado' };
          }

          const user = users[0];

          // Obtener grupos del usuario
          const memberships = await this.supabase.query<{
            group_name: string;
            group_id: number;
            is_admin: boolean;
            turn_number: number;
            group_status: string;
          }>(
            `SELECT g.name as group_name, g.id as group_id, m.is_admin, m.turn_number, g.status as group_status
             FROM memberships m
             JOIN groups g ON g.id = m.group_id
             WHERE m.user_id = $1`,
            [user.id],
          );

          return {
            status: 'success',
            user: {
              id: user.id,
              phone: user.phone_number,
              name: user.username,
              hasStellarWallet: !!user.stellar_public_key,
            },
            groups: memberships.map((m) => ({
              name: m.group_name,
              groupId: m.group_id,
              isAdmin: m.is_admin,
              turnNumber: m.turn_number,
              status: m.group_status,
            })),
          };
        } catch (error) {
          this.logger.error(
            `Error obteniendo info de usuario: ${(error as Error).message}`,
          );
          return { status: 'error', error: (error as Error).message };
        }
      },
    });
  }

  // =========================================================================
  // TOOL: Verificar código OTP del usuario
  // =========================================================================
  get verifyPhoneCodeTool(): FunctionTool {
    return new FunctionTool({
      name: 'verify_phone_code',
      description: `Valida un código OTP enviado por el usuario para confirmar su teléfono.
        El código debe extraerse en el prompt (entre ~* y *~ u otro formato definido) y pasarse como argumento.`,
      parameters: z.object({
        senderPhone: z
          .string()
          .describe('Número de teléfono que envió el código'),
        // eslint-disable-next-line prettier/prettier
        code: z
          .string()
          .describe('Código OTP extraído del mensaje'),
        whatsappUsername: z
          .string()
          .optional()
          .describe('Nombre visible del contacto, si está disponible'),
      }),
      execute: async (args, toolContext?: ToolContext) => {
        try {
          const senderPhone = this.normalizePhone(args.senderPhone);
          const normalizedCode = args.code.trim();
          if (!normalizedCode) {
            return {
              status: 'not_verified',
              message: 'No se proporcionó un código válido en la herramienta.',
            };
          }
          const verified = await this.verification.confirmCode(
            senderPhone,
            normalizedCode,
            args.whatsappUsername,
          );

          if (verified) {
            if (toolContext) {
              toolContext.state['user:phone_verified'] = true;
              toolContext.state['user:phone_verified_at'] =
                new Date().toISOString();
              toolContext.state['user:phone'] = senderPhone;
            }

            if (this.verificationStickerUrl) {
              await this.messaging.sendSticker(
                senderPhone,
                { link: this.verificationStickerUrl },
                { phoneNumberId: this.phoneNumberId },
              );
            }
            return {
              status: 'verified',
              message:
                '✅ Verificamos tu teléfono correctamente. Continúa con el formulario para crear tu tanda.',
            };
          }

          return {
            status: 'not_verified',
            message:
              'No encontramos un código válido en tu mensaje. Copia el código tal como aparece entre ~* y *~.',
          };
        } catch (error) {
          this.logger.error(
            `Error verificando código OTP: ${(error as Error).message}`,
          );
          return { status: 'error', error: (error as Error).message };
        }
      },
    });
  }

  // =========================================================================
  // TOOL: Responder a invitación (aceptar/rechazar)
  // =========================================================================
  get respondToInvitationTool(): FunctionTool {
    return new FunctionTool({
      name: 'respond_to_invitation',
      description:
        'Permite aceptar o rechazar una invitación a una tanda usando el invite_code. Si aceptas, crea el usuario y la membresía en la base de datos.',
      parameters: z.object({
        invitedPhone: z.string().describe('Teléfono del usuario invitado'),
        inviteCode: z.string().describe('Código de invitación recibido'),
        action: z
          .enum(['ACCEPT', 'DECLINE'])
          .describe('Acción a ejecutar sobre la invitación'),
        invitedName: z
          .string()
          .optional()
          .describe('Nombre del invitado si está disponible'),
      }),
      execute: async (args, toolContext?: ToolContext) => {
        this.logger.log('📰 Ejecutando respondToInvitationTool');
        const invitedPhone = this.normalizePhone(args.invitedPhone);
        const inviteCode = args.inviteCode.trim();
        if (!inviteCode) {
          return { status: 'error', error: 'inviteCode vacío' };
        }

        const invitations = await this.supabase.query<{
          id: number;
          group_id: number;
          invited_phone: string;
          status: string;
          expires_at: string | null;
        }>(
          `
            select id, group_id, invited_phone, status, expires_at
            from group_invitations
            where invite_code = $1 and invited_phone = $2
            limit 1
          `,
          [inviteCode, invitedPhone],
        );

        const invitation = invitations[0];
        if (!invitation) {
          return {
            status: 'not_found',
            message:
              'No encontré esa invitación. Verifica el código y vuelve a intentarlo.',
          };
        }

        if (invitation.status === 'ACCEPTED') {
          return {
            status: 'already_accepted',
            message:
              'Esta invitación ya fue aceptada. Ya eres miembro de la tanda.',
          };
        }
        if (invitation.status === 'DECLINED') {
          return {
            status: 'already_declined',
            message: 'Esta invitación ya fue rechazada.',
          };
        }

        if (invitation.expires_at) {
          const expiresAt = Date.parse(invitation.expires_at);
          if (!Number.isNaN(expiresAt) && expiresAt < Date.now()) {
            await this.supabase.query(
              `update group_invitations set status = 'EXPIRED', responded_at = timezone('utc', now()) where id = $1`,
              [invitation.id],
            );
            return {
              status: 'expired',
              message: 'La invitación expiró. Pide que te envíen una nueva.',
            };
          }
        }

        if (args.action === 'DECLINE') {
          await this.supabase.query(
            `update group_invitations set status = 'DECLINED', responded_at = timezone('utc', now()) where id = $1`,
            [invitation.id],
          );
          return {
            status: 'declined',
            message:
              'Invitación rechazada. Si fue un error, pide una nueva invitación.',
          };
        }

        // ACCEPT: crear/actualizar usuario y membresía
        const user = await this.groupCreation.upsertUser({
          phone: invitedPhone,
          username: args.invitedName ?? invitedPhone,
          preferredCurrency:
            (toolContext?.state?.['user:preferred_currency'] as string) ??
            'USD',
        });

        const maxTurn = await this.supabase.query<{ max_turn: number }>(
          `select coalesce(max(turn_number), 0) as max_turn from memberships where group_id = $1`,
          [invitation.group_id],
        );
        const turnNumber = (maxTurn[0]?.max_turn ?? 0) + 1;

        const membershipRows = await this.supabase.query<{ id: number }>(
          `
            insert into memberships (user_id, group_id, is_admin, turn_number)
            values ($1, $2, false, $3)
            on conflict (user_id, group_id) do update set turn_number = excluded.turn_number
            returning id
          `,
          [user.userId, invitation.group_id, turnNumber],
        );
        const membershipId = membershipRows[0]?.id ?? null;

        await this.supabase.query(
          `
            update group_invitations
            set status = 'ACCEPTED', responded_at = timezone('utc', now()), invited_user_id = $1, membership_id = $2
            where id = $3
          `,
          [user.userId, membershipId, invitation.id],
        );

        if (this.welcomeStickerUrl) {
          await this.messaging.sendSticker(
            invitedPhone,
            { link: this.welcomeStickerUrl },
            { phoneNumberId: this.phoneNumberId },
          );
        }

        if (toolContext) {
          toolContext.state['user:selected_group_id'] = invitation.group_id;
          toolContext.state['user:phone'] = invitedPhone;
        }

        return {
          status: 'accepted',
          message: `✅ Invitación aceptada. Ya formas parte de la tanda. Tu turno asignado es #${turnNumber}.`,
          groupDbId: invitation.group_id,
          membershipId,
          turnNumber,
        };
      },
    });
  }

  // =========================================================================
  // TOOL: Elegir método de retiro del ganador
  // =========================================================================
  get choosePayoutMethodTool(): FunctionTool {
    return new FunctionTool({
      name: 'choose_payout_method',
      description:
        'Registra/ejecuta la selección de retiro del ganador del ciclo (FIAT/USDC/LATER). Para USDC intenta ejecutar payout en Soroban si hay contrato y wallet.',
      parameters: z.object({
        senderPhone: z.string().describe('Teléfono del ganador que elige'),
        groupId: z
          .string()
          .describe('ID del grupo (id numérico o group_whatsapp_id)'),
        cycleIndex: z
          .number()
          .optional()
          .describe('Índice del ciclo (0-based) si está disponible'),
        method: z.enum(['FIAT', 'USDC', 'LATER']).describe('Método de retiro'),
      }),
      execute: async (args, toolContext?: ToolContext) => {
        const senderPhone = this.normalizePhone(args.senderPhone);
        const resolvedGroupId = this.parseGroupId(args.groupId);
        const cycleLabel =
          typeof args.cycleIndex === 'number'
            ? ` (ciclo #${args.cycleIndex + 1})`
            : '';

        if (toolContext) {
          toolContext.state['payout:last_method'] = args.method;
          toolContext.state['payout:last_group_id'] = resolvedGroupId;
          if (typeof args.cycleIndex === 'number') {
            toolContext.state['payout:last_cycle_index'] = args.cycleIndex;
          }
        }

        if (args.method === 'LATER') {
          return {
            status: 'deferred',
            message: `Perfecto${cycleLabel}. Cuando quieras retirar, vuelve a elegir un método.`,
          };
        }

        if (args.method === 'FIAT') {
          return {
            status: 'queued',
            message:
              `Listo${cycleLabel}. Registré que quieres retirar a banco. ` +
              'En esta versión el off-ramp FIAT aún no está integrado automáticamente.',
          };
        }

        // USDC payout via Soroban
        const groups = await this.supabase.query<{
          id: number;
          name: string;
          contract_address: string | null;
        }>(
          `select id, name, contract_address
           from groups
           where id::text = $1 or group_whatsapp_id = $1
           limit 1`,
          [resolvedGroupId],
        );

        const group = groups[0];
        if (!group?.contract_address) {
          return {
            status: 'error',
            message:
              'No tengo contrato asociado a esa tanda todavía. Primero debe estar activa.',
          };
        }

        const users = await this.supabase.query<{
          stellar_public_key: string | null;
        }>(
          `select stellar_public_key
           from users
           where phone_number = $1 or phone_number like $2
           limit 1`,
          [senderPhone, `%${senderPhone.slice(-10)}`],
        );

        const stellarPublicKey = users[0]?.stellar_public_key;
        if (!stellarPublicKey) {
          return {
            status: 'error',
            message:
              'No encuentro tu wallet Stellar para hacer el payout. Completa tu registro primero.',
          };
        }

        try {
          const { txHash } = await this.soroban.payout(
            group.contract_address,
            stellarPublicKey,
          );
          return {
            status: 'paid',
            message:
              `Payout USDC solicitado${cycleLabel} para "${group.name}".` +
              (txHash ? ` Tx: ${txHash}` : ''),
          };
        } catch (error) {
          this.logger.error(
            `Error ejecutando payout USDC: ${(error as Error).message}`,
          );
          return {
            status: 'error',
            message:
              'No pude ejecutar el payout USDC en este momento. Intenta más tarde.',
          };
        }
      },
    });
  }

  // =========================================================================
  // GETTER: Todas las tools como array
  // =========================================================================
  get allTools(): FunctionTool[] {
    return [
      this.createGroupTool,
      this.selectAdminGroupTool,
      this.addParticipantTool,
      this.configureGroupTool,
      this.checkGroupStatusTool,
      this.startTandaTool,
      this.createPaymentLinkTool,
      this.verifyPaymentProofTool,
      this.getUserInfoTool,
      this.verifyPhoneCodeTool,
      this.respondToInvitationTool,
      this.choosePayoutMethodTool,
    ];
  }

  private normalizePhone(raw: string): string {
    return String(raw ?? '').replace(/\D/g, '');
  }

  private async createInvitationCodeWithRetry(params: {
    groupDbId: number;
    inviterPhone: string;
    invitedPhone: string;
  }): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const inviteCode = this.generateInviteCode();
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

    throw new Error(
      'No se pudo generar un código de invitación único. Intenta nuevamente.',
    );
  }

  private generateInviteCode(): string {
    return randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  }

  private parseGroupId(raw: string): string {
    const trimmed = raw.trim();
    const match = trimmed.match(/(\d+)$/);
    return match ? match[1] : trimmed;
  }

  private async sendInvitationMessage(params: {
    to: string;
    groupName: string;
    inviteCode: string;
  }): Promise<void> {
    const buttons: WhatsAppInteractiveButton[] = [
      {
        type: 'reply',
        reply: { id: `invite_accept:${params.inviteCode}`, title: 'Aceptar' },
      },
      {
        type: 'reply',
        reply: {
          id: `invite_decline:${params.inviteCode}`,
          title: 'Rechazar',
        },
      },
    ];

    await this.messaging.sendInteractiveButtons(
      params.to,
      `📩 Te invitaron a unirte a la tanda "${params.groupName}".\n\nSelecciona una opción:`,
      buttons,
      {
        phoneNumberId: this.phoneNumberId,
        header: this.invitationImageUrl
          ? { type: 'image', image: { link: this.invitationImageUrl } }
          : undefined,
        footer: `Código: ${params.inviteCode}`.slice(0, 60),
      },
    );

    // Fallback por si el cliente del usuario no muestra botones
    await this.messaging.sendText(
      params.to,
      `Si no ves botones, responde:\nACEPTAR ${params.inviteCode}\nRECHAZAR ${params.inviteCode}`,
      { phoneNumberId: this.phoneNumberId },
    );
  }

  private async sendAdminGroupSelectionList(params: {
    to: string;
    purpose:
      | 'CONFIGURE_TANDA'
      | 'CHECK_STATUS'
      | 'ADD_PARTICIPANT'
      | 'START_TANDA';
  }): Promise<void> {
    const to = this.normalizePhone(params.to);
    const users = await this.supabase.query<{ id: string }>(
      `
        select id
        from users
        where phone_number = $1 or phone_number like $2
        limit 1
      `,
      [to, `%${to.slice(-10)}`],
    );

    const userId = users[0]?.id;
    if (!userId) {
      await this.messaging.sendText(
        to,
        'No encontré tu usuario. Primero registra tu número y vuelve a intentar.',
        { phoneNumberId: this.phoneNumberId },
      );
      return;
    }

    const adminGroups = await this.supabase.query<{
      id: number;
      name: string;
      status: string;
    }>(
      `
        select g.id, g.name, g.status
        from memberships m
        join groups g on g.id = m.group_id
        where m.user_id = $1 and m.is_admin = true
        order by g.id desc
        limit 10
      `,
      [userId],
    );

    if (!adminGroups.length) {
      await this.messaging.sendText(
        to,
        'No tienes tandas como administrador todavía.',
        { phoneNumberId: this.phoneNumberId },
      );
      return;
    }

    const prefix =
      params.purpose === 'CONFIGURE_TANDA'
        ? 'tanda:configure:'
        : params.purpose === 'ADD_PARTICIPANT'
          ? 'tanda:add_participant:'
          : params.purpose === 'START_TANDA'
            ? 'tanda:start:'
            : 'tanda:status:';

    const sections: WhatsAppInteractiveListSection[] = [
      {
        title: 'Tus tandas',
        rows: adminGroups.slice(0, 10).map((g) => ({
          id: `${prefix}${g.id}`.slice(0, 200),
          title: String(g.name ?? `Tanda ${g.id}`).slice(0, 24),
          description: `Estado: ${g.status}`.slice(0, 72),
        })),
      },
    ];

    const bodyText =
      params.purpose === 'CONFIGURE_TANDA'
        ? 'Selecciona la tanda que deseas configurar:'
        : params.purpose === 'ADD_PARTICIPANT'
          ? 'Selecciona la tanda donde quieres agregar al participante:'
          : params.purpose === 'START_TANDA'
            ? 'Selecciona la tanda que deseas iniciar:'
            : 'Selecciona la tanda que deseas consultar:';

    await this.messaging.sendInteractiveList(
      to,
      bodyText,
      'Ver tandas',
      sections,
      {
        phoneNumberId: this.phoneNumberId,
        header: 'Tandas administradas',
      },
    );
  }
}
