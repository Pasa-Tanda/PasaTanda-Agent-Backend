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
Debes entender la intención del usuario y ejecutar la acción apropiada usando tus herramientas.
NO debes transferir a otros agentes, usa directamente las herramientas disponibles.

INTENCIONES QUE MANEJAS:

1. **CREAR GRUPO/TANDA** - Usuario quiere crear una nueva tanda
   - Palabras clave: "crear", "nueva tanda", "iniciar grupo", "armar tanda"
   - Usa: create_pasatanda_group

2. **AGREGAR PARTICIPANTE** - Usuario quiere agregar miembros
   - Palabras clave: "agregar", "invitar", "añadir a", "incluir a"
   - Usa: add_participant_to_group

3. **CONFIGURAR TANDA** - Usuario quiere cambiar valores
   - Palabras clave: "configurar", "cambiar monto", "modificar frecuencia"
   - Usa: configure_tanda

4. **CONSULTAR ESTADO** - Usuario quiere ver información
   - Palabras clave: "estado", "cómo va", "info", "ver tanda", "mi turno"
   - Usa: check_group_status, get_user_info

5. **PAGAR CUOTA** - Usuario quiere pagar
   - Palabras clave: "pagar", "cuota", "link de pago", "QR"
   - Usa: create_payment_link

6. **VERIFICAR COMPROBANTE** - Usuario subió comprobante
  - Palabras clave: "comprobante", "voucher", "recibo", "pagué", imagen
  - Usa: verify_payment_proof

7. **VERIFICAR TELÉFONO** - Usuario envía un código OTP (~*ABC123*~)
  - Palabras clave: "código", "verificación", "OTP", "PIN"
  - Extrae el código (un OTP de 6 cifras) dentro del agente y pásalo como argumento \`code\` al tool \`verify_phone_code\`. No envíes todo el texto al tool.
  - Usa: verify_phone_code con senderPhone y el código extraído

8. **AYUDA GENERAL** - Usuario necesita ayuda
  - Palabras clave: "ayuda", "cómo funciona", "qué puedo hacer"
  - Responde explicando las funciones disponibles

CONTEXTO DEL USUARIO:
- El número de teléfono del usuario está disponible en el contexto
- Puedes consultar sus grupos con get_user_info

FORMATO DE RESPUESTA:
- Responde en español
- Sé conciso pero amigable
- Usa emojis moderadamente 🎯
- Si hay error, explica qué salió mal y cómo solucionarlo
- Si falta información, pregunta específicamente qué necesitas

EJEMPLO DE INTERACCIONES:
- "quiero crear una tanda" → Usa create_pasatanda_group con los datos del contexto
- "pagar 100" → Usa create_payment_link con amountUsd: 100
- "cómo va mi tanda" → Usa get_user_info para ver grupos, luego check_group_status
- "agregar a 584147891234" → Usa add_participant_to_group`;

    // Crear el agente orquestador con todas las herramientas
    try {
      this.orchestratorAgent = new LlmAgent({
        name: 'pasatanda_orchestrator',
        model,
        instruction: orchestratorInstruction,
        description:
          'Orquestador principal de PasaTanda que maneja todas las funciones de tandas',
        //tools: this.tools.allTools,
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
        const structuredData = JSON.parse(jsonMatch[1]);

        // Si es un link de pago, enviar template
        if (structuredData.paymentUrl || structuredData.payment_url) {
          actions.push({
            type: 'template',
            templateName: 'payment_request',
            templateParams: {
              month: structuredData.month || 'Cuota',
              totalAmount:
                structuredData.totalAmount || structuredData.amount || '0',
              exchangeRate: structuredData.exchangeRate || '1.00',
              groupName: structuredData.groupName || 'Tu Tanda',
              paymentUrl:
                structuredData.paymentUrl || structuredData.payment_url,
              headerImageUrl: structuredData.qrImageUrl,
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
        if (structuredData.options && Array.isArray(structuredData.options)) {
          const buttons = structuredData.options
            .slice(0, 3)
            .map((opt: any, idx: number) => ({
              type: 'reply' as const,
              reply: {
                id: opt.id || `option_${idx}`,
                title: String(opt.title || opt.label || opt).slice(0, 20),
              },
            }));

          if (buttons.length > 0) {
            actions.push({
              type: 'interactive_buttons',
              text:
                structuredData.message ||
                structuredData.text ||
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
