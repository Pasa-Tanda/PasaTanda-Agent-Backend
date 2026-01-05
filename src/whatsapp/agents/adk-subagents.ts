import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmAgent, Gemini, FunctionTool } from '@google/adk';
import { z } from 'zod';
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
3. **Configurar valores**: Usa configure_tanda para ajustar montos, frecuencia y opciones.
4. **Consultar estado**: Usa check_group_status para ver información de un grupo.
5. **Información de usuario**: Usa get_user_info para ver los grupos de un usuario.

CONTEXTO IMPORTANTE:
- Todos los grupos inician en estado DRAFT
- El creador del grupo es automáticamente el administrador
- Los turnos se asignan secuencialmente al agregar participantes
- Los montos son en USD (se convierten a Bs para pagos locales)
- yield_enabled activa la generación de rendimientos en el contrato Stellar

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
        this.tools.addParticipantTool,
        this.tools.configureGroupTool,
        this.tools.checkGroupStatusTool,
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
