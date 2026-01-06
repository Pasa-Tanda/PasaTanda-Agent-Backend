import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FunctionTool, ToolContext } from '@google/adk';
import { z } from 'zod';
import { SupabaseService } from '../services/supabase.service';
import { GroupCreationService } from '../../frontend-creation/group-creation.service';
import { PaymentIntegrationService } from '../services/payment-integration.service';
import { VerificationService } from '../services/verification.service';
import { WhatsAppMessagingService } from '../services/whatsapp-messaging.service';
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

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
    private readonly groupCreation: GroupCreationService,
    private readonly payments: PaymentIntegrationService,
    private readonly verification: VerificationService,
    private readonly messaging: WhatsAppMessagingService,
  ) {
    this.paymentPage = this.config.get<string>('MAIN_PAGE_URL', '');
    this.phoneNumberId =
      this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID', '') ||
      this.config.get<string>('PHONE_NUMBER_ID', '');
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
          const subject =
            args.groupName || `PasaTanda ${new Date().getMonth() + 1}`;
          const invitedPhones = Array.from(new Set(args.participants ?? []))
            .filter(Boolean)
            .filter((phone) => phone !== args.senderPhone);

          // Crear usuario en base de datos
          const user = await this.groupCreation.upsertUser({
            phone: args.senderPhone,
            username: args.senderPhone,
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
            toolContext.state['user:phone'] = args.senderPhone;
          }

          const invitations = await Promise.all(
            invitedPhones.map(async (invitedPhone) => {
              const inviteCode = await this.createInvitationCodeWithRetry({
                groupDbId: draftGroup.groupDbId,
                inviterPhone: args.senderPhone,
                invitedPhone,
              });

              if (this.phoneNumberId) {
                await this.messaging.sendText(
                  invitedPhone,
                  `📩 Te invitaron a unirte a la tanda "${subject}".\n\nPara aceptar responde: ACEPTAR ${inviteCode}\nPara rechazar responde: RECHAZAR ${inviteCode}`,
                  { phoneNumberId: this.phoneNumberId },
                );
              }

              return { invitedPhone, inviteCode };
            }),
          );

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
  // TOOL: Agregar participante a grupo
  // =========================================================================
  get addParticipantTool(): FunctionTool {
    return new FunctionTool({
      name: 'add_participant_to_group',
      description: `Agrega un nuevo participante a un grupo de tanda existente.
        Envía una invitación por WhatsApp para que el usuario acepte y se una a la tanda.`,
      parameters: z.object({
        groupId: z
          .string()
          .describe(
            'ID del grupo (puede ser el ID de base de datos o WhatsApp)',
          ),
        participantPhone: z
          .string()
          .describe('Número de teléfono del nuevo participante'),
        participantName: z
          .string()
          .optional()
          .describe('Nombre del participante'),
      }),
      execute: async (args, toolContext?: ToolContext) => {
        try {
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
            [args.groupId],
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
            inviterPhone,
            invitedPhone: args.participantPhone,
          });

          if (this.phoneNumberId) {
            await this.messaging.sendText(
              args.participantPhone,
              `📩 Te invitaron a unirte a la tanda "${group.name}".\n\nPara aceptar responde: ACEPTAR ${inviteCode}\nPara rechazar responde: RECHAZAR ${inviteCode}`,
              { phoneNumberId: this.phoneNumberId },
            );
          }

          if (toolContext) {
            toolContext.state['user:selected_group_id'] = group.id;
            toolContext.state['user:selected_group_name'] = group.name;
          }

          return {
            status: 'success',
            inviteCode,
            message: `Invitación enviada a ${args.participantPhone} para unirse a "${group.name}".`,
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
        groupId: z.string().describe('ID del grupo'),
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
      execute: async (args) => {
        try {
          const updates: string[] = [];
          const values: unknown[] = [];
          let paramIndex = 1;

          if (args.amountUsd !== undefined) {
            updates.push(`amount = $${paramIndex++}`);
            values.push(args.amountUsd);
          }
          if (args.frequencyDays !== undefined) {
            updates.push(`frequency_days = $${paramIndex++}`);
            values.push(args.frequencyDays);
          }
          if (args.yieldEnabled !== undefined) {
            updates.push(`yield_enabled = $${paramIndex++}`);
            values.push(args.yieldEnabled);
          }

          if (updates.length === 0) {
            return {
              status: 'no_changes',
              message: 'No se especificaron cambios',
            };
          }

          values.push(args.groupId);

          await this.supabase.query(
            `UPDATE groups SET ${updates.join(', ')} 
             WHERE group_whatsapp_id = $${paramIndex} OR id::text = $${paramIndex}`,
            values,
          );

          return {
            status: 'success',
            message: 'Configuración de la tanda actualizada',
            changes: {
              amountUsd: args.amountUsd,
              frequencyDays: args.frequencyDays,
              yieldEnabled: args.yieldEnabled,
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
        groupId: z.string().describe('ID del grupo'),
      }),
      execute: async (args) => {
        try {
          const groups = await this.supabase.query<{
            id: number;
            name: string;
            status: string;
            contract_address: string | null;
            frequency_days: number;
            yield_enabled: boolean;
            amount: number;
          }>(
            `SELECT id, name, status, contract_address, frequency_days, yield_enabled, amount
             FROM groups
             WHERE group_whatsapp_id = $1 OR id::text = $1
             LIMIT 1`,
            [args.groupId],
          );

          if (!groups.length) {
            return { status: 'not_found', message: 'Grupo no encontrado' };
          }

          const group = groups[0];

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
              amountUsd: group.amount,
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
            payTo: args.payTo ?? args.senderPhone,
            details: args.details,
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
          const verification = await this.payments.verifyFiat({
            orderId: args.orderId,
            proofMetadata: args.extractedData ?? {},
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
            [args.phone, `%${args.phone.replace(/\D/g, '').slice(-10)}`],
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
          const normalizedCode = args.code.trim();
          if (!normalizedCode) {
            return {
              status: 'not_verified',
              message: 'No se proporcionó un código válido en la herramienta.',
            };
          }
          const verified = await this.verification.confirmCode(
            args.senderPhone,
            normalizedCode,
            args.whatsappUsername,
          );

          if (verified) {
            if (toolContext) {
              toolContext.state['user:phone_verified'] = true;
              toolContext.state['user:phone_verified_at'] =
                new Date().toISOString();
              toolContext.state['user:phone'] = args.senderPhone;
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
          [inviteCode, args.invitedPhone],
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
          phone: args.invitedPhone,
          username: args.invitedName ?? args.invitedPhone,
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

        if (toolContext) {
          toolContext.state['user:selected_group_id'] = invitation.group_id;
          toolContext.state['user:phone'] = args.invitedPhone;
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
  // GETTER: Todas las tools como array
  // =========================================================================
  get allTools(): FunctionTool[] {
    return [
      this.createGroupTool,
      this.addParticipantTool,
      this.configureGroupTool,
      this.checkGroupStatusTool,
      this.createPaymentLinkTool,
      this.verifyPaymentProofTool,
      this.getUserInfoTool,
      this.verifyPhoneCodeTool,
      this.respondToInvitationTool,
    ];
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
}
