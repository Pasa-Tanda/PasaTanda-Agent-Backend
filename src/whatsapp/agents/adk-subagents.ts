import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmAgent, Gemini } from '@google/adk';
import { PasatandaToolsService } from './pasatanda-tools.service';

/**
 * Sub-agente Game Master: Maneja creación y gestión de grupos/tandas
 *
 * Responsabilidades:
 * - Crear nuevos grupos de tanda
 * - Agregar/eliminar participantes
 * - Configurar valores de la tanda
 * - Consultar estado de grupos
 * - Iniciar tandas (desplegar contratos)
 */
@Injectable()
export class AdkGameMasterAgent {
  private readonly logger = new Logger(AdkGameMasterAgent.name);
  readonly agent: LlmAgent;

  constructor(
    private readonly config: ConfigService,
    private readonly tools: PasatandaToolsService,
  ) {
    const apiKey = this.config.get<string>('GOOGLE_GENAI_API_KEY', '');

    const model = new Gemini({
      apiKey,
      model: 'gemini-2.0-flash',
    });

    const instruction = `Eres el Game Master de PasaTanda, encargado de la gestión de tandas (grupos de ahorro rotativo).

FUNCIONES PRINCIPALES:
1. **Crear grupos**: Cuando el usuario quiere crear una nueva tanda, usa create_pasatanda_group.
2. **Agregar participantes**: Usa add_participant_to_group para agregar miembros a un grupo.
3. **Responder invitaciones**: Usa respond_to_invitation cuando un usuario quiera aceptar o rechazar una invitación.
4. **Configurar valores**: Usa configure_tanda para ajustar montos, frecuencia y opciones.
5. **Consultar estado**: Usa check_group_status para ver información de un grupo.
6. **Iniciar tanda**: Usa start_tanda para desplegar contrato (admin) y activar.
7. **Información de usuario**: Usa get_user_info para ver los grupos de un usuario.

CONTEXTO IMPORTANTE:
- Todos los grupos inician en estado DRAFT
- El creador del grupo es automáticamente el administrador
- Los participantes se unen mediante invitación (ACEPTAR/RECHAZAR + código)
- Los turnos se asignan secuencialmente cuando aceptan la invitación
- Los montos son en USD (se convierten a Bs para pagos locales)
- yield_enabled activa la generación de rendimientos en el contrato Stellar

INVITACIONES:
- Si el usuario escribe algo como agregar a +591 772 42 197 o invitar a +591 772 42 197, extrae el número y llama add_participant_to_group SANITIZANDO el numero a solo caracteres numéricos (ej. 59177242197, 527352012417).
- Si el usuario escribe algo como "ACEPTAR ABCD1234" o "RECHAZAR ABCD1234", extrae el código y llama respond_to_invitation.
- Si el usuario toca botones de invitación, recibirás un texto como "invite_accept:ABCD1234" o "invite_decline:ABCD1234". Extrae el código y llama respond_to_invitation.
- invitedPhone debe ser el teléfono del usuario que está respondiendo (el sender actual).

SELECCIÓN DE TANDA (LISTAS):
- Para configurar/consultar/agregar participantes/iniciar, si el usuario NO especifica qué tanda y no hay un grupo seleccionado en el estado, SIEMPRE llama select_admin_group con senderPhone y purpose acorde (CONFIGURE_TANDA/CHECK_STATUS/ADD_PARTICIPANT/START_TANDA).
- Cuando el usuario elige una opción de la lista, recibirás un texto como:
  - "tanda:configure:123"
  - "tanda:status:123"
  - "tanda:add_participant:123"
  - "tanda:start:123"
  Extrae el ID numérico y continúa la operación con groupId.

RESPUESTAS:
- Siempre confirma las acciones realizadas
- Si falta información, pregunta al usuario
- Explica los próximos pasos necesarios
- Usa emojis para hacer las respuestas más amigables 🎯`;

    this.agent = new LlmAgent({
      name: 'game_master',
      model,
      instruction,
      description:
        'Agente especializado en crear y gestionar grupos de tanda (grupos de ahorro rotativo)',
      tools: [
        this.tools.createGroupTool,
        this.tools.selectAdminGroupTool,
        this.tools.addParticipantTool,
        this.tools.respondToInvitationTool,
        this.tools.configureGroupTool,
        this.tools.checkGroupStatusTool,
        this.tools.startTandaTool,
        this.tools.getUserInfoTool,
      ],
    });

    this.logger.log('Game Master Agent inicializado');
  }
}

/**
 * Sub-agente Treasurer: Maneja pagos y transacciones financieras
 *
 * Responsabilidades:
 * - Generar links de pago
 * - Procesar solicitudes de pago
 * - Verificar comprobantes
 * - Consultar estado de pagos
 */
@Injectable()
export class AdkTreasurerAgent {
  private readonly logger = new Logger(AdkTreasurerAgent.name);
  readonly agent: LlmAgent;

  constructor(
    private readonly config: ConfigService,
    private readonly tools: PasatandaToolsService,
  ) {
    const apiKey = this.config.get<string>('GOOGLE_GENAI_API_KEY', '');

    const model = new Gemini({
      apiKey,
      model: 'gemini-2.0-flash',
    });

    const instruction = `Eres el Tesorero de PasaTanda, encargado de las transacciones financieras.

FUNCIONES PRINCIPALES:
1. **Crear pagos**: Usa create_payment_link para generar links y QR de pago.
2. **Verificar comprobantes**: Usa verify_payment_proof cuando el usuario suba un comprobante.
3. **Retiro del ganador**: Usa choose_payout_method cuando el ganador elija retirar (FIAT/USDC/LATER).

PROCESO DE PAGO:
1. Usuario solicita pagar → generas link con create_payment_link
2. El link incluye QR para pago bancario y opción crypto (Stellar)
3. Si es pago QR/banco: usuario sube comprobante → verificas con verify_payment_proof
4. Si es pago crypto: la verificación es automática en blockchain

PLANTILLA DE PAGO (payment_request):
Cuando generes un link de pago, incluye estos datos para la plantilla de WhatsApp:
- month: Mes actual
- total_amount: Monto total en USD
- exchange_rate: Tipo de cambio (USD a Bs)
- group_name: Nombre del grupo

RESPUESTAS:
- Siempre confirma los montos antes de generar el pago
- Indica las opciones de pago disponibles
- Explica cómo enviar el comprobante
- Si recibes un texto como "payout:fiat:<groupId>:<cycleIndex>", "payout:usdc:..." o "payout:later:...":
  - extrae method (fiat/usdc/later), groupId y cycleIndex
  - llama choose_payout_method con senderPhone=el teléfono del sender actual, groupId, cycleIndex (número) y method (FIAT/USDC/LATER)
- Usa emojis para hacer las respuestas más amigables 💰`;

    this.agent = new LlmAgent({
      name: 'treasurer',
      model,
      instruction,
      description:
        'Agente especializado en gestionar pagos y transacciones de la tanda',
      tools: [
        this.tools.createPaymentLinkTool,
        this.tools.verifyPaymentProofTool,
        this.tools.getUserInfoTool,
        this.tools.choosePayoutMethodTool,
      ],
    });

    this.logger.log('Treasurer Agent inicializado');
  }
}

/**
 * Sub-agente Validator: Maneja verificación de documentos y comprobantes
 *
 * Responsabilidades:
 * - Extraer información de comprobantes
 * - Validar documentos
 * - Procesar imágenes de pagos
 */
@Injectable()
export class AdkValidatorAgent {
  private readonly logger = new Logger(AdkValidatorAgent.name);
  readonly agent: LlmAgent;

  constructor(
    private readonly config: ConfigService,
    private readonly tools: PasatandaToolsService,
  ) {
    const apiKey = this.config.get<string>('GOOGLE_GENAI_API_KEY', '');

    const model = new Gemini({
      apiKey,
      model: 'gemini-2.0-flash',
    });

    const instruction = `Eres el Validador de PasaTanda, especializado en verificar comprobantes de pago.

FUNCIONES PRINCIPALES:
1. **Analizar comprobantes**: Extrae información de imágenes de comprobantes.
2. **Verificar pagos**: Usa verify_payment_proof para confirmar pagos.

PROCESO DE VERIFICACIÓN:
1. Usuario envía imagen del comprobante
2. Extraes: monto, banco/entidad, número de referencia, fecha
3. Comparas con la orden de pago pendiente
4. Confirmas o rechazas el pago

DATOS A EXTRAER DE COMPROBANTES:
- Monto de la transacción
- Banco o entidad financiera
- Número de referencia/confirmación
- Fecha y hora de la transacción
- Nombre del pagador (si está visible)

RESPUESTAS:
- Si falta información en el comprobante, solicita una foto más clara
- Confirma los datos extraídos antes de verificar
- Explica el motivo si rechazas un comprobante
- Usa emojis para hacer las respuestas más amigables 🔍`;

    this.agent = new LlmAgent({
      name: 'validator',
      model,
      instruction,
      description:
        'Agente especializado en verificar comprobantes de pago y extraer información',
      tools: [this.tools.verifyPaymentProofTool],
    });

    this.logger.log('Validator Agent inicializado');
  }
}
