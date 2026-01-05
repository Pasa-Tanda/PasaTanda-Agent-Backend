import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { SupabaseService } from '../services/supabase.service';
import { GroupService } from '../services/group.service';
import { GroupCreationService } from '../../frontend-creation/group-creation.service';
import { PaymentIntegrationService } from '../services/payment-integration.service';
import { VerificationService } from '../services/verification.service';
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
    private readonly groupService: GroupService,
    private readonly groupCreation: GroupCreationService,
    private readonly payments: PaymentIntegrationService,
    private readonly verification: VerificationService,
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
        El grupo se crea tanto en WhatsApp como en la base de datos.
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
      execute: async (args) => {
        try {
          const subject =
            args.groupName || `PasaTanda ${new Date().getMonth() + 1}`;
          const participants = Array.from(
            new Set([args.senderPhone, ...(args.participants ?? [])]),
          ).filter(Boolean);

          // Crear grupo en WhatsApp
          let whatsappGroupId: string | undefined;
          if (this.phoneNumberId) {
            try {
              const groupResult = await this.groupService.createGroup(
                this.phoneNumberId,
                {
                  subject,
                  participants,
                },
              );
              whatsappGroupId = groupResult.id;
            } catch (error) {
              this.logger.warn(
                `No se pudo crear grupo en WhatsApp: ${(error as Error).message}`,
              );
            }
          }

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
            whatsappGroupId,
          });

          // Crear membresía del admin
          await this.groupCreation.createMembership({
            userId: user.userId,
            groupDbId: draftGroup.groupDbId,
            isAdmin: true,
            turnNumber: 1,
          });

          return {
            status: 'success',
            groupName: subject,
            groupDbId: draftGroup.groupDbId,
            whatsappGroupId: whatsappGroupId ?? 'pendiente',
            message: `Grupo "${subject}" creado exitosamente. Estado: DRAFT. Usa "iniciar tanda" cuando todos los participantes estén listos.`,
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
        Crea el usuario si no existe y lo agrega como miembro del grupo.`,
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
      execute: async (args) => {
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

          // Crear/actualizar usuario
          const user = await this.groupCreation.upsertUser({
            phone: args.participantPhone,
            username: args.participantName ?? args.participantPhone,
            preferredCurrency: 'USD',
          });

          // Verificar si ya es miembro
          const existingMember = await this.supabase.query(
            `SELECT id FROM memberships WHERE user_id = $1 AND group_id = $2`,
            [user.userId, group.id],
          );

          if (existingMember.length > 0) {
            return {
              status: 'already_member',
              message: `${args.participantPhone} ya es miembro del grupo "${group.name}"`,
            };
          }

          // Obtener el siguiente número de turno
          const maxTurn = await this.supabase.query<{ max_turn: number }>(
            `SELECT COALESCE(MAX(turn_number), 0) as max_turn FROM memberships WHERE group_id = $1`,
            [group.id],
          );

          // Crear membresía
          await this.groupCreation.createMembership({
            userId: user.userId,
            groupDbId: group.id,
            isAdmin: false,
            turnNumber: (maxTurn[0]?.max_turn ?? 0) + 1,
          });

          return {
            status: 'success',
            message: `${args.participantPhone} agregado al grupo "${group.name}"`,
            turnNumber: (maxTurn[0]?.max_turn ?? 0) + 1,
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
      execute: async (args) => {
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
    ];
  }
}
