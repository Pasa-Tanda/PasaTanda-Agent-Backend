import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LlmAgent,
  Gemini,
  Runner,
  isFinalResponse,
  stringifyContent,
} from '@google/adk';
//import type { Session, Event } from '@google/adk';
import { SupabaseSessionService } from '../services/supabase-session.service';
import {
  AdkGameMasterAgent,
  AdkTreasurerAgent,
  AdkValidatorAgent,
} from './adk-subagents';
import { PasatandaToolsService } from './pasatanda-tools.service';
import type { RouterMessageContext } from '../whatsapp.types';
import type {
  WhatsAppInteractiveButton,
  WhatsAppInteractiveListSection,
  WhatsAppTemplateComponent,
  WhatsAppLocation,
} from '../services/whatsapp-messaging.service';

export type PasatandaIntent =
  | 'PAY_QUOTA'
  | 'CHECK_STATUS'
  | 'CREATE_GROUP'
  | 'ADD_PARTICIPANT'
  | 'CONFIGURE_TANDA'
  | 'START_TANDA'
  | 'UPLOAD_PROOF'
  | 'VERIFY_PHONE'
  | 'GENERAL_HELP'
  | 'UNKNOWN';

/**
 * Tipos de acciones que el orquestador puede generar.
 * Soporta todos los tipos de mensajes de WhatsApp Cloud API.
 */
export type OrchestrationAction =
  | {
      type: 'text';
      text: string;
      to?: string;
    }
  | {
      type: 'image';
      imageUrl?: string;
      base64?: string;
      mimeType?: string;
      caption?: string;
      to?: string;
    }
  | {
      type: 'document';
      documentUrl?: string;
      base64?: string;
      mimeType?: string;
      filename?: string;
      caption?: string;
      to?: string;
    }
  | {
      type: 'video';
      videoUrl?: string;
      caption?: string;
      to?: string;
    }
  | {
      type: 'audio';
      audioUrl?: string;
      to?: string;
    }
  | {
      type: 'location';
      location: WhatsAppLocation;
      to?: string;
    }
  | {
      type: 'template';
      templateName: string;
      languageCode?: string;
      templateComponents?: WhatsAppTemplateComponent[];
      templateParams?: {
        month: string;
        totalAmount: string;
        exchangeRate: string;
        groupName: string;
        headerImageUrl?: string;
        paymentUrl?: string;
      };
      to?: string;
    }
  | {
      type: 'interactive_buttons';
      text: string;
      buttons: WhatsAppInteractiveButton[];
      header?:
        | { type: 'text'; text: string }
        | { type: 'image'; image: { link: string } };
      footer?: string;
      to?: string;
    }
  | {
      type: 'interactive_list';
      text: string;
      buttonText?: string;
      sections: WhatsAppInteractiveListSection[];
      listHeader?: string;
      footer?: string;
      to?: string;
    }
  | {
      type: 'reaction';
      emoji: string;
      messageId: string;
      to?: string;
    }
  | {
      type: 'sticker';
      stickerUrl?: string;
      stickerId?: string;
      to?: string;
    };

export interface OrchestrationResult {
  intent: PasatandaIntent;
  actions: OrchestrationAction[];
  agentUsed: string;
  sessionState?: Record<string, unknown>;
}

/**
 * Orquestador principal de PasaTanda usando Google ADK.
 *
 * Arquitectura multi-agente:
 * - Orchestrator (este agente): Clasifica intenciones y delega a sub-agentes
 * - Game Master: Gestión de grupos y tandas
 * - Treasurer: Pagos y transacciones
 * - Validator: Verificación de comprobantes
 *
 * La verificación de teléfono ahora se maneja como una tool dedicada invocada desde este orquestador.
 */
@Injectable()
export class AdkOrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(AdkOrchestratorService.name);
  private readonly appName = 'pasatanda';
  private runner!: Runner;
  private orchestratorAgent!: LlmAgent;

  constructor(
    private readonly config: ConfigService,
    private readonly sessionService: SupabaseSessionService,
    private readonly tools: PasatandaToolsService,
    private readonly gameMasterAgent: AdkGameMasterAgent,
    private readonly treasurerAgent: AdkTreasurerAgent,
    private readonly validatorAgent: AdkValidatorAgent,
  ) {}

  onModuleInit() {
    this.initializeOrchestrator();
  }

  private initializeOrchestrator(): void {
    console.log('Inicializando ADK Orchestrator Service... BMS ☢️☢️☢️');
    const apiKey = this.config.get<string>('GOOGLE_GENAI_API_KEY', '');
    const model = new Gemini({
      apiKey,
      model: 'gemini-2.0-flash',
    });
    console.log('API Key:', apiKey, 'Model:', model, '☢️☢️☢️');

    // Instrucción del orquestador principal
    const orchestratorInstruction = `Eres el orquestador principal de PasaTanda, una aplicación de tandas (grupos de ahorro rotativo) en WhatsApp.

  TU ROL:
  - Identifica la intención del usuario.
  - DEBES delegar al subagente correcto (transferencia) para ejecutar tools de negocio.
  - EXCEPCIÓN: la verificación de teléfono se ejecuta únicamente desde el orquestador con el tool \`verify_phone_code\`.

  SUBAGENTES DISPONIBLES (transfiere según corresponda):
  1) \`game_master\`: creación/gestión de grupos, participantes, configuración, estado.
  2) \`treasurer\`: pagos, generación de links/QR, validaciones relacionadas a pagos.
  3) \`validator\`: análisis/verificación de comprobantes y datos extraídos.

  REGLAS DE TOOLS:
  - No llames herramientas de grupos/pagos directamente desde el orquestador.
  - Sólo puedes llamar \`verify_phone_code\`.

  INTENCIONES PRINCIPALES:
  - **VERIFICAR TELÉFONO**: el usuario envía un OTP (p.ej. ~*123456*~).
    - Extrae el código dentro del agente y pásalo como argumento \`code\` al tool \`verify_phone_code\`. No envíes todo el texto al tool.
    - Llama \`verify_phone_code\` con \`senderPhone\` y el código extraído.
  - **CREAR/CONFIGURAR/CONSULTAR**: transfiere a \`game_master\`.
  - **PAGAR**: transfiere a \`treasurer\`.
  - **COMPROBANTE**: transfiere a \`validator\` (o \`treasurer\` si ya hay orden y sólo falta confirmar).
  - **AYUDA**: responde tú mismo sin tools, de forma breve.

  ESTADO PERSISTENTE (session.state):
  - Puedes apoyarte en estos valores si existen: grupo seleccionado {user:selected_group_id?}, moneda preferida {user:preferred_currency?}, teléfono verificado {user:phone_verified?}.

  FORMATO DE RESPUESTA:
  - Responde en español.
  - Sé conciso pero amigable.
  - Si falta información, pregunta específicamente qué necesitas.`;

    // Crear el agente orquestador con todas las herramientas
    try {
      this.orchestratorAgent = new LlmAgent({
        name: 'pasatanda_orchestrator',
        model,
        instruction: orchestratorInstruction,
        description:
          'Orquestador principal que enruta intenciones y delega a subagentes',
        tools: [this.tools.verifyPhoneCodeTool],
        // Sub-agentes disponibles para transfer si es necesario
        subAgents: [
          this.gameMasterAgent.agent,
          this.treasurerAgent.agent,
          this.validatorAgent.agent,
        ],
      });
    } catch (error) {
      this.logger.error(
        `Error creando el agente orquestador: ${(error as Error).message}`,
      );
      throw error;
    }

    try {
      // Crear el runner con el session service
      this.runner = new Runner({
        agent: this.orchestratorAgent,
        appName: this.appName,
        sessionService: this.sessionService,
      });
      this.logger.log('ADK Orchestrator inicializado con sub-agentes');
    } catch (error) {
      this.logger.error(
        `Error creando el runner del orquestador: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Procesa un mensaje y genera acciones de respuesta.
   * Este es el punto de entrada principal desde whatsapp.service.ts
   */
  async route(context: RouterMessageContext): Promise<OrchestrationResult> {
    const userId = this.normalizePhone(context.senderId);
    const sessionId = `${this.appName}:${userId}`;
    console.log(
      'Orquestador procesando mensaje de:',
      context.senderId,
      userId,
      sessionId,
      '☢️☢️☢️',
    );

    try {
      // Obtener o crear sesión
      let session = await this.sessionService.getSession({
        appName: this.appName,
        userId,
        sessionId,
      });

      if (!session) {
        try {
          session = await this.sessionService.createSession({
            appName: this.appName,
            userId,
            sessionId,
            state: {
              'user:phone': context.senderId,
              groupId: context.groupId,
            },
          });
          console.log('Sesión creada en orquestador:', sessionId, '☢️☢️☢️');
        } catch (error) {
          this.logger.error(
            `Error creando sesión en orquestador: ${(error as Error).message}`,
          );
        }
      } else {
        console.log('Sesión existente en orquestador:', sessionId, '☢️☢️☢️');
      }

      // Preparar el mensaje para ADK (tipo inline compatible con Gemini SDK)
      const userMessage = {
        role: 'user' as const,
        parts: [{ text: this.buildPrompt(context) }],
      };

      // Ejecutar el agente
      let responseText = '';
      let agentUsed = 'orchestrator';

      // Se itera sobre los eventos generados por el runner para capturar la respuesta final
      for await (const event of this.runner.runAsync({
        userId,
        sessionId,
        newMessage: userMessage,
      })) {
        // Capturar el nombre del agente que respondió
        if (event.author && event.author !== 'user') {
          agentUsed = event.author;
        }

        // Capturar la respuesta final
        if (isFinalResponse(event)) {
          responseText = stringifyContent(event);
        }
      }

      // Determinar el intent basado en la respuesta y herramientas usadas
      const intent = this.detectIntent(context.originalText, responseText);

      // Construir las acciones de respuesta
      const actions = this.buildActions(responseText, context.senderId);

      // Obtener el estado actualizado de la sesión
      const updatedSession = await this.sessionService.getSession({
        appName: this.appName,
        userId,
        sessionId,
      });

      return {
        intent,
        actions,
        agentUsed,
        sessionState: updatedSession?.state as Record<string, unknown>,
      };
    } catch (error) {
      this.logger.error(`Error en orquestación: ${(error as Error).message}`);
      this.logger.error((error as Error).stack);

      return {
        intent: 'UNKNOWN',
        actions: [
          {
            type: 'text',
            text: 'Ocurrió un error procesando tu mensaje. Por favor intenta de nuevo o escribe "ayuda" para ver las opciones disponibles.',
          },
        ],
        agentUsed: 'orchestrator',
      };
    }
  }

  /**
   * Construye el prompt enriquecido con contexto
   */
  private buildPrompt(context: RouterMessageContext): string {
    const parts: string[] = [];

    // Mensaje principal
    parts.push(context.originalText);

    // Agregar contexto relevante
    const contextParts: string[] = [];
    contextParts.push(`[Teléfono del usuario: ${context.senderId}]`);

    if (context.groupId) {
      contextParts.push(`[Grupo WhatsApp: ${context.groupId}]`);
    }

    if (context.senderName) {
      contextParts.push(`[Nombre WhatsApp: ${context.senderName}]`);
    }

    if (context.referredProduct) {
      contextParts.push(
        `[Producto referido: ${context.referredProduct.productRetailerId}]`,
      );
    }

    if (contextParts.length > 0) {
      parts.push(`\n---\nContexto:\n${contextParts.join('\n')}`);
    }

    return parts.join('\n');
  }

  /**
   * Detecta la intención basada en el mensaje y respuesta
   */
  private detectIntent(
    userMessage: string,
    agentResponse: string,
  ): PasatandaIntent {
    const lowerMessage = userMessage.toLowerCase();
    const lowerResponse = agentResponse.toLowerCase();

    // Patrones de detección
    if (/~\*|otp|c[oó]digo|pin/.test(lowerMessage)) {
      return 'VERIFY_PHONE';
    }
    if (/crear|nueva tanda|iniciar grupo|armar/.test(lowerMessage)) {
      return 'CREATE_GROUP';
    }
    if (/agregar|invitar|añadir|incluir/.test(lowerMessage)) {
      return 'ADD_PARTICIPANT';
    }
    if (/configurar|cambiar|modificar/.test(lowerMessage)) {
      return 'CONFIGURE_TANDA';
    }
    if (/estado|cómo va|info|ver tanda|mi turno/.test(lowerMessage)) {
      return 'CHECK_STATUS';
    }
    if (/pagar|cuota|link.*pago|qr/.test(lowerMessage)) {
      return 'PAY_QUOTA';
    }
    if (/comprobante|voucher|recibo|pagué/.test(lowerMessage)) {
      return 'UPLOAD_PROOF';
    }
    if (/ayuda|cómo funciona|qué puedo/.test(lowerMessage)) {
      return 'GENERAL_HELP';
    }
    if (/iniciar.*tanda|desplegar|activar/.test(lowerMessage)) {
      return 'START_TANDA';
    }

    // Detectar por contenido de respuesta
    if (/grupo.*creado|tanda.*creada/.test(lowerResponse)) {
      return 'CREATE_GROUP';
    }
    if (
      /(tel[eé]fono).*(verificado|validado)|c[oó]digo.*(verificado|validado)/.test(
        lowerResponse,
      )
    ) {
      return 'VERIFY_PHONE';
    }
    if (/link.*pago|qr.*generado|payment/.test(lowerResponse)) {
      return 'PAY_QUOTA';
    }
    if (/verificado|comprobante/.test(lowerResponse)) {
      return 'UPLOAD_PROOF';
    }

    return 'UNKNOWN';
  }

  /**
   * Construye las acciones de respuesta a partir del texto del agente
   */
  private buildActions(
    responseText: string,
    defaultRecipient: string,
  ): OrchestrationAction[] {
    if (!responseText.trim()) {
      return [
        {
          type: 'text',
          text: 'No pude generar una respuesta. ¿Puedes reformular tu mensaje?',
          to: defaultRecipient,
        },
      ];
    }

    const actions: OrchestrationAction[] = [];

    // Detectar si hay datos estructurados en la respuesta (JSON embedido)
    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        const parsed: unknown = JSON.parse(jsonMatch[1]);
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('JSON no es un objeto');
        }

        const data = parsed as Record<string, unknown>;
        const paymentUrl =
          typeof data.paymentUrl === 'string'
            ? data.paymentUrl
            : typeof data.payment_url === 'string'
              ? data.payment_url
              : undefined;

        // Si es un link de pago, enviar template
        if (paymentUrl) {
          const month = typeof data.month === 'string' ? data.month : 'Cuota';
          const totalAmount =
            typeof data.totalAmount === 'string' ||
            typeof data.totalAmount === 'number'
              ? String(data.totalAmount)
              : typeof data.amount === 'string' ||
                  typeof data.amount === 'number'
                ? String(data.amount)
                : '0';
          const exchangeRate =
            typeof data.exchangeRate === 'string' ||
            typeof data.exchangeRate === 'number'
              ? String(data.exchangeRate)
              : '1.00';
          const groupName =
            typeof data.groupName === 'string' ? data.groupName : 'Tu Tanda';
          const headerImageUrl =
            typeof data.qrImageUrl === 'string' ? data.qrImageUrl : undefined;

          actions.push({
            type: 'template',
            templateName: 'payment_request',
            templateParams: {
              month,
              totalAmount,
              exchangeRate,
              groupName,
              paymentUrl,
              headerImageUrl,
            },
            to: defaultRecipient,
          });

          // Agregar texto explicativo sin el JSON
          const cleanText = responseText
            .replace(/```json\n[\s\S]*?\n```/, '')
            .trim();
          if (cleanText) {
            actions.push({
              type: 'text',
              text: cleanText,
              to: defaultRecipient,
            });
          }
          return actions;
        }

        // Si hay opciones, crear botones interactivos
        const options = Array.isArray(data.options) ? data.options : undefined;
        if (options) {
          const buttons: WhatsAppInteractiveButton[] = options
            .slice(0, 3)
            .map((opt, idx: number) => {
              const optObj =
                opt && typeof opt === 'object'
                  ? (opt as Record<string, unknown>)
                  : undefined;
              const id =
                optObj && typeof optObj.id === 'string'
                  ? optObj.id
                  : `option_${idx}`;
              const titleRaw =
                optObj && typeof optObj.title === 'string'
                  ? optObj.title
                  : optObj && typeof optObj.label === 'string'
                    ? optObj.label
                    : String(opt);

              return {
                type: 'reply',
                reply: {
                  id,
                  title: titleRaw.slice(0, 20),
                },
              };
            });

          if (buttons.length > 0) {
            actions.push({
              type: 'interactive_buttons',
              text:
                (typeof data.message === 'string' && data.message) ||
                (typeof data.text === 'string' && data.text) ||
                'Selecciona una opción:',
              buttons,
              to: defaultRecipient,
            });
            return actions;
          }
        }
      } catch {
        // Si falla el parse, continuar con respuesta de texto
      }
    }

    // Detectar si hay una imagen/QR base64 en la respuesta
    const base64Match = responseText.match(
      /data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)/,
    );
    if (base64Match) {
      actions.push({
        type: 'image',
        base64: base64Match[2],
        mimeType: `image/${base64Match[1]}`,
        caption:
          responseText.replace(base64Match[0], '').trim().slice(0, 200) ||
          undefined,
        to: defaultRecipient,
      });
      return actions;
    }

    // Respuesta de texto normal
    actions.push({
      type: 'text',
      text: responseText,
      to: defaultRecipient,
    });

    return actions;
  }

  /**
   * Normaliza un número de teléfono
   */
  private normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
  }
}
