import { Injectable, Logger } from '@nestjs/common';
import { AppointmentAgentService } from '../agents/appointment-agent.service';
import { ReportingAgentService } from '../agents/reporting-agent.service';
import { SalesAgentService } from '../agents/sales-agent.service';
import { SanitizationService } from './sanitization.service';
import {
  AgentResponse,
  Intent,
  RouterMessageContext,
  RouterResult,
  SanitizedTextResult,
  UserRole,
} from '../whatsapp.types';
import { OnboardingService } from './onboarding.service';
import { GeminiService } from './gemini.service';

@Injectable()
export class AgentRouterService {
  // Orquestador principal alineado al diseño multi-agente de Google ADK.
  private readonly logger = new Logger(AgentRouterService.name);
  private readonly adminOnlyIntents = new Set<Intent>([
    Intent.REPORTING,
    Intent.TWO_FA,
  ]);

  constructor(
    private readonly sanitizationService: SanitizationService,
    private readonly appointmentAgent: AppointmentAgentService,
    private readonly salesAgent: SalesAgentService,
    private readonly reportingAgent: ReportingAgentService,
    private readonly onboardingService: OnboardingService,
    private readonly geminiService: GeminiService,
  ) {}

  async routeTextMessage(context: RouterMessageContext): Promise<RouterResult> {
    const sanitized = this.sanitizationService.sanitize(context.originalText);

    const onboarding = await this.onboardingService.run(context);
    if (onboarding) {
      return {
        role: context.role,
        intent: 'FALLBACK',
        sanitized,
        ...onboarding,
      };
    }

    // Usar Gemini para detección de intención
    const intent = await this.detectIntentWithGemini(
      sanitized.normalizedText,
      context,
    );

    const role = context.role;

    if (!intent) {
      // Gemini genera fallback contextualizado
      const fallbackResponse = await this.buildGeminiFallback(
        context,
        sanitized,
      );
      return {
        role,
        intent: 'FALLBACK',
        sanitized,
        ...fallbackResponse,
      };
    }

    if (this.adminOnlyIntents.has(intent) && role !== UserRole.ADMIN) {
      return {
        role,
        intent,
        sanitized,
        actions: [
          {
            type: 'text',
            text: 'Esta acción requiere permisos de administrador. Si necesitas soporte, contacta al número autorizado.',
          },
        ],
      };
    }

    let agentResponse: AgentResponse;

    switch (intent) {
      case Intent.BOOKING:
        agentResponse = await this.appointmentAgent.handle(context, sanitized);
        break;
      case Intent.SHOPPING:
        agentResponse = await this.salesAgent.handleShoppingIntent(
          context,
          sanitized,
        );
        break;
      case Intent.REPORTING:
        agentResponse = await this.reportingAgent.handle(context, sanitized);
        break;
      case Intent.TWO_FA:
        agentResponse = await this.salesAgent.handleTwoFactorReply(
          context,
          sanitized,
        );
        break;
      default:
        agentResponse = {
          actions: [
            {
              type: 'text',
              text: 'Operación no soportada por el orquestador.',
            },
          ],
        };
    }

    this.logger.debug(
      `Intent ${intent} atendido por ${agentResponse.metadata ? 'agente especializado' : 'router'}`,
    );

    return {
      role,
      intent,
      sanitized,
      ...agentResponse,
    };
  }

  /**
   * Detecta la intención del usuario usando Gemini.
   * Si Gemini no está disponible, usa regex como fallback.
   */
  private async detectIntentWithGemini(
    text: string,
    context: RouterMessageContext,
  ): Promise<Intent | null> {
    if (!this.geminiService.isEnabled()) {
      this.logger.warn(
        'Gemini no disponible, usando regex para detección de intent',
      );
      return this.detectIntentFallback(text);
    }

    try {
      const model = this.geminiService.getModel();
      if (!model) {
        return this.detectIntentFallback(text);
      }

      const config = context.tenant.companyConfig;
      const profile = this.safeObject(config?.profile);
      const agentName = profile.agent_name || 'asistente';

      const prompt = `Eres ${agentName}, un asistente virtual multiagente. Analiza el mensaje del usuario y determina la intención principal.

Intenciones posibles:
- BOOKING: Usuario quiere agendar cita, programar reunión, reservar servicio
- SHOPPING: Usuario quiere comprar producto, consultar stock, generar QR de pago
- REPORTING: Usuario (admin) solicita reportes, KPIs, estadísticas
- TWO_FA: Usuario (admin) responde con token/código de verificación bancaria

Mensaje: "${text}"

Responde SOLO con una de estas palabras exactas: BOOKING, SHOPPING, REPORTING, TWO_FA, NONE
Si no estás seguro o es saludo/consulta general, responde: NONE`;

      const result = await this.geminiService.generateText(prompt);

      const responseText = result?.trim().toUpperCase() || '';

      if (responseText.includes('BOOKING')) return Intent.BOOKING;
      if (responseText.includes('SHOPPING')) return Intent.SHOPPING;
      if (responseText.includes('REPORTING')) return Intent.REPORTING;
      if (responseText.includes('TWO_FA')) return Intent.TWO_FA;

      return null;
    } catch (error) {
      this.logger.error('Error en detección de intent con Gemini:', error);
      return this.detectIntentFallback(text);
    }
  }

  /**
   * Genera respuesta fallback usando Gemini con contexto de la empresa.
   */
  private async buildGeminiFallback(
    context: RouterMessageContext,
    sanitized: SanitizedTextResult,
  ): Promise<AgentResponse> {
    if (!this.geminiService.isEnabled()) {
      return this.buildConfigAwareFallback(context, sanitized);
    }

    try {
      const model = this.geminiService.getModel();
      if (!model) {
        return this.buildConfigAwareFallback(context, sanitized);
      }

      const config = context.tenant.companyConfig;
      const profile = this.safeObject(config?.profile);
      const businessInfo = this.safeObject(config?.business_info);
      const salesPolicy = this.safeObject(config?.sales_policy);
      const ops = this.safeObject(config?.operational_rules);

      const agentName = profile.agent_name || 'asistente';
      const tone = profile.tone || 'amigable y profesional';
      const persona = profile.persona_description || 'un asistente útil';

      const capabilities =
        context.role === UserRole.ADMIN
          ? 'Puedes pedirme reportes, conectar tu calendario Google, y aprobar tokens de pago.'
          : 'Puedo ayudarte a agendar citas, consultar productos y realizar compras.';

      const instruction = `Eres ${agentName}, ${persona}. Tu tono es ${tone}.

Contexto de la empresa:
- Nombre: ${context.tenant.companyName}
${businessInfo.value_proposition ? `- Propuesta de valor: ${businessInfo.value_proposition}` : ''}
${businessInfo.industry ? `- Industria: ${businessInfo.industry}` : ''}
${salesPolicy.delivery_cost ? `- Costo de envío: ${salesPolicy.delivery_cost}` : ''}
${salesPolicy.refund_policy ? `- Política de devolución: ${salesPolicy.refund_policy}` : ''}
${ops.opening_hours ? `- Horarios: ${JSON.stringify(ops.opening_hours)}` : ''}
${ops.contact_phone ? `- Contacto directo: ${ops.contact_phone}` : ''}

${capabilities}

El usuario te escribió: "${sanitized.normalizedText}"

Genera una respuesta natural y útil que:
1. Responda al mensaje del usuario de forma contextualizada
2. Menciona brevemente qué puedes hacer (citas, productos, pagos)
3. Invita a continuar la conversación
4. Usa el tono configurado
5. NO copies literalmente los campos de configuración
6. Máximo 3-4 líneas

Respuesta en español:`;

      const result = await this.geminiService.generateText(instruction);

      const responseText = result || 'Error de inicialización de gemini.';

      return {
        actions: [
          {
            type: 'text',
            text: responseText,
          },
        ],
        metadata: {
          fallback: true,
          gemini_powered: true,
          sanitizedPreview: sanitized.sanitizedText.slice(0, 160),
          persona: agentName,
        },
      };
    } catch (error) {
      this.logger.error('Error en fallback de Gemini:', error);
      return this.buildConfigAwareFallback(context, sanitized);
    }
  }

  private buildConfigAwareFallback(
    context: RouterMessageContext,
    sanitized: SanitizedTextResult,
  ): AgentResponse {
    const profile = this.safeObject(context.tenant.companyConfig?.profile);
    const businessInfo = this.safeObject(
      context.tenant.companyConfig?.business_info,
    );
    const salesPolicy = this.safeObject(
      context.tenant.companyConfig?.sales_policy,
    );
    const ops = this.safeObject(
      context.tenant.companyConfig?.operational_rules,
    );

    const agentName = profile.agent_name ?? 'Tu asistente virtual';
    const toneHint = profile.tone ? ` (${profile.tone})` : '';
    const persona = profile.persona_description
      ? `Soy ${agentName}${toneHint}. ${profile.persona_description}`
      : `Soy ${agentName}${toneHint}, tu asistente.`;

    const valueProp = businessInfo.value_proposition
      ? `Estamos enfocados en ${businessInfo.value_proposition}`
      : undefined;

    const industry = businessInfo.industry
      ? `Sector: ${businessInfo.industry}.`
      : undefined;

    const delivery = salesPolicy.delivery_cost
      ? `Envíos: ${salesPolicy.delivery_cost}.`
      : undefined;

    const refund = salesPolicy.refund_policy
      ? `Postventa: ${salesPolicy.refund_policy}`
      : undefined;

    const stockBehavior = salesPolicy.stock_behavior;

    const hours = this.formatOpeningHours(ops.opening_hours);
    const contactPhone = ops.contact_phone
      ? `Contacto directo: ${ops.contact_phone}.`
      : undefined;

    const capabilities = this.describeCapabilities(context.role);

    const guidance = this.describeGuidance(context.role, stockBehavior);

    const body = [
      persona,
      valueProp,
      industry,
      capabilities,
      guidance,
      delivery,
      refund,
      hours,
      contactPhone,
      '¿Te ayudo con una cita, revisar stock o preparar una compra?',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      actions: [
        {
          type: 'text',
          text: body,
        },
      ],
      metadata: {
        fallback: true,
        sanitizedPreview: sanitized.sanitizedText.slice(0, 160),
        persona: agentName,
      },
    };
  }

  private describeCapabilities(role: UserRole): string {
    if (role === UserRole.ADMIN) {
      return 'Como admin puedo generar reportes, ajustar credenciales (Google OAuth) y aprobar tokens bancarios cuando el flujo lo pida.';
    }
    return 'Puedo agendar encuentros, contarte sobre productos y ayudarte a cerrar compras con QR o pago en tienda.';
  }

  private describeGuidance(role: UserRole, stockBehavior?: string): string {
    if (role === UserRole.ADMIN) {
      return 'Escríbeme "Reporte" para métricas, "Token" para 2FA o "Conectar calendario" para actualizar credenciales.';
    }
    const stockLine = stockBehavior
      ? `Si algo no está en stock, te sugiero: ${stockBehavior}`
      : undefined;
    return [
      'Usa palabras como *cita*, *producto*, *pagar* o *promos* y te guiaré paso a paso.',
      stockLine,
    ]
      .filter(Boolean)
      .join(' ');
  }

  private formatOpeningHours(
    openingHours?: Record<string, string>,
  ): string | undefined {
    if (!openingHours) {
      return undefined;
    }
    const entries = Object.entries(openingHours)
      .map(([day, schedule]) => `${day}: ${schedule}`)
      .join(' | ');
    return `Horarios: ${entries}.`;
  }

  private safeObject<T extends Record<string, any>>(value: unknown): T {
    if (!value || typeof value !== 'object') {
      return {} as T;
    }
    return value as T;
  }

  private detectIntentFallback(text: string): Intent | null {
    if (/(cita|agenda|agendar|calendario|reprogramar)/.test(text)) {
      return Intent.BOOKING;
    }
    if (
      /(carrito|comprar|venta|pagar|qr|pedido|orden|checkout|generar)/.test(
        text,
      )
    ) {
      return Intent.SHOPPING;
    }
    if (/(reporte|reporting|kpi|estadistic|inventario|dashboard)/.test(text)) {
      return Intent.REPORTING;
    }
    if (/(token|2fa|codigo|código|factor)/.test(text)) {
      return Intent.TWO_FA;
    }
    return null;
  }
}
