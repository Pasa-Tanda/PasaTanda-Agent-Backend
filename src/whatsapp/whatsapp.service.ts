import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import FormData from 'form-data';
import {
  WhatsAppMessage,
  WhatsAppIncomingMessage,
  WhatsAppStatus,
  SendMessageDto,
  WhatsAppContact,
} from './interfaces/whatsapp.interface';
import { PasatandaOrchestratorService } from './services/pasatanda-orchestrator.service';
import { PinataService } from './services/pinata.service';
import { VerificationService } from './services/verification.service';
import { FrontendWebhookService } from './services/frontend-webhook.service';
import type { RouterAction, TenantContext } from './whatsapp.types';
import { UserRole } from './whatsapp.types';

interface MessageContextOptions {
  tenant?: TenantContext;
  companyId?: string;
  phoneNumberId?: string;
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly apiVersion: string;
  private readonly apiToken: string;
  private readonly defaultPhoneNumberId: string;
  // Cache in-memory para evitar reprocesar mensajes cuando Meta reintenta el webhook.
  private readonly processedMessageCache = new Map<string, number>();
  private readonly processedMessageTtlMs = 10 * 60 * 1000; // 10 minutos

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly orchestrator: PasatandaOrchestratorService,
    private readonly pinataService: PinataService,
    private readonly verificationService: VerificationService,
    private readonly frontendWebhook: FrontendWebhookService,
  ) {
    this.apiVersion = this.configService.get<string>(
      'WHATSAPP_API_VERSION',
      'v21.0',
    );
    this.defaultPhoneNumberId = this.configService.get<string>(
      'WHATSAPP_PHONE_NUMBER_ID',
      '',
    );
    this.apiToken = this.configService.get<string>('META_API_TOKEN', '');
  }

  /**
   * Verifica el webhook de WhatsApp
   */
  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    const verifyToken = this.configService.get<string>(
      'WHATSAPP_VERIFY_TOKEN',
      '',
    );

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('Webhook verificado correctamente');
      return challenge;
    }

    this.logger.error('Verificación de webhook fallida');
    return null;
  }

  /**
   * Procesa los mensajes entrantes de WhatsApp
   */
  async processIncomingMessage(body: WhatsAppMessage): Promise<void> {
    try {
      // Log del payload completo para debugging
      this.logger.debug('Payload recibido:', JSON.stringify(body, null, 2));

      // Verificar que el objeto sea de WhatsApp
      if (body.object !== 'whatsapp_business_account') {
        this.logger.warn('Objeto no es de WhatsApp Business Account');
        return;
      }

      // Procesar cada entrada
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          const value = change.value;
          const phoneNumberId = value.metadata?.phone_number_id;
          const tenant = this.buildTenantContext(phoneNumberId);

          // Procesar mensajes
          if (value.messages && value.messages.length > 0) {
            for (const message of value.messages) {
              const contactWaId = this.resolveContactWaId(
                value.contacts,
                message.from,
              );
              await this.handleMessage(message, tenant, contactWaId);
            }
          }

          // Procesar estados de mensajes (enviado, entregado, leído, etc.)
          if (value.statuses && value.statuses.length > 0) {
            for (const status of value.statuses) {
              this.handleMessageStatus(status);
            }
          }
        }
      }
    } catch (error) {
      const safeError = error as Error & { response?: { data?: unknown } };
      const details = safeError.response?.data ?? safeError.message;
      this.logger.error('Error procesando mensaje entrante:', details);
      this.logger.error('Stack trace:', safeError.stack);
      this.logger.error('Payload completo:', JSON.stringify(body, null, 2));
      throw safeError;
    }
  }

  /**
   * Maneja un mensaje individual
   */
  private async handleMessage(
    message: WhatsAppIncomingMessage,
    tenant: TenantContext,
    contactWaId?: string,
  ): Promise<void> {
    if (this.isDuplicateMessage(message.id)) {
      this.logger.warn(
        `Mensaje duplicado detectado (id=${message.id}). Se omite para evitar reprocesamiento.`,
      );
      return;
    }

    this.logger.log(`Mensaje recibido de: ${message.from}`);
    this.logger.log(`Tipo de mensaje: ${message.type}`);

    // Log de información adicional si está disponible
    if (message.context) {
      this.logger.log(
        `Mensaje con contexto - Origen: ${message.context.from}, ID: ${message.context.id}`,
      );
      if (message.context.referred_product) {
        this.logger.log(
          `Producto referenciado - Catálogo: ${message.context.referred_product.catalog_id}, Producto: ${message.context.referred_product.product_retailer_id}`,
        );
      }
    }

    if (message.referral) {
      this.logger.log(
        `Mensaje desde anuncio - Tipo: ${message.referral.source_type}, URL: ${message.referral.source_url}`,
      );
      this.logger.log(`Headline: ${message.referral.headline}`);
      this.logger.log(`Body: ${message.referral.body}`);
      if (message.referral.ctwa_clid) {
        this.logger.log(`CTWA Click ID: ${message.referral.ctwa_clid}`);
      }
    }

    // Marcar el mensaje como leído
    await this.markAsRead(message.id, tenant);

    switch (message.type) {
      case 'text':
        if (message.text) {
          this.logger.log(`Texto: ${message.text.body}`);
          await this.handleTextMessage(message, tenant, contactWaId);
        }
        break;

      case 'image':
        this.logger.log('Imagen recibida:', message.image);
        await this.handleMediaMessage(message, 'image', tenant);
        break;

      case 'video':
        this.logger.log('Video recibido:', message.video);
        await this.handleMediaMessage(message, 'video', tenant);
        break;

      case 'audio':
        this.logger.log('Audio recibido:', message.audio);
        await this.handleMediaMessage(message, 'audio', tenant);
        break;

      case 'document':
        this.logger.log('Documento recibido:', message.document);
        await this.handleMediaMessage(message, 'document', tenant);
        break;

      case 'location':
        this.logger.log('Ubicación recibida:', message.location);
        await this.handleLocationMessage(message, tenant);
        break;

      case 'interactive':
        this.logger.log('Interacción recibida:', message.interactive);
        await this.handleInteractiveMessage(message, tenant);
        break;

      case 'button':
        this.logger.log('Botón presionado');
        await this.handleButtonMessage(message, tenant);
        break;

      case 'reaction':
        this.logger.log('Reacción recibida');
        break;

      case 'sticker':
        this.logger.log('Sticker recibido');
        break;

      case 'order':
        this.logger.log('Orden recibida');
        break;

      case 'system':
        this.logger.log('Mensaje de sistema recibido');
        break;

      case 'unsupported':
        this.logger.warn('Tipo de mensaje no soportado');
        if (message.errors && message.errors.length > 0) {
          message.errors.forEach((error) => {
            this.logger.error(
              `Error ${error.code}: ${error.title} - ${error.message || 'Sin detalles'}`,
            );
          });
        }
        break;

      default:
        this.logger.warn(`Tipo de mensaje no manejado: ${message.type}`);
    }
  }

  /**
   * Maneja mensajes de texto con lógica de respuesta automática
   */
  private async handleTextMessage(
    message: WhatsAppIncomingMessage,
    tenant: TenantContext,
    contactWaId?: string,
  ): Promise<void> {
    if (!message.text) return;

    const canonicalSender = contactWaId ?? message.from;
    this.logger.log(`📨 Procesando mensaje de ${canonicalSender} para empresa ${tenant.companyName}`);

    const verifiedNow = await this.verificationService.tryConfirmFromMessage(
      canonicalSender,
      message.text.body,
    );

    if (verifiedNow) {
      await this.frontendWebhook.sendVerificationConfirmation({
        phone: canonicalSender,
        verified: true,
        timestamp: Date.now(),
        whatsappNumber: canonicalSender,
      });
      await this.sendTextMessage(
        canonicalSender,
        '✔️ Verificamos tu teléfono. Ahora completa el formulario en la web y presiona "Crear Tanda".',
        { tenant },
      );
      return;
    }

    // Si el mensaje parece un código de verificación pero no coincidió, no lo envíes al orquestador.
    if (/[A-Z0-9]{6}/i.test(message.text.body)) {
      await this.sendTextMessage(
        canonicalSender,
        'El código ingresado no es válido o ya expiró. Vuelve a solicitarlo desde el formulario y envíalo tal cual aparece.',
        { tenant },
      );
      return;
    }

    const role = UserRole.CLIENT;

    const routerResult = await this.orchestrator.route({
      senderId: canonicalSender,
      whatsappMessageId: message.id,
      originalText: message.text.body,
      message,
      tenant,
      role,
      groupId: message.group?.id ?? (message as any)?.group_id ?? (message.context as any)?.group_id,
    });

    this.logger.debug(`Despachando ${routerResult.actions.length} acciones...`);
    for (const action of routerResult.actions) {
      const recipient = action.to ?? canonicalSender;
      await this.dispatchAction(recipient, action, tenant);
    }

    this.logger.log(`✅ Mensaje procesado completamente para ${canonicalSender}`);
  }

  /**
   * Maneja mensajes con medios (imagen, video, audio, documento)
   */
  private async handleMediaMessage(
    message: WhatsAppIncomingMessage,
    mediaType: 'image' | 'video' | 'audio' | 'document',
    tenant: TenantContext,
  ): Promise<void> {
    const media = message[mediaType];
    if (!media) return;

    this.logger.log(
      `${mediaType} recibido - ID: ${media.id}, MIME: ${media.mime_type}`,
    );

    // Aquí puedes implementar lógica para descargar y procesar el medio
    // Por ejemplo: const mediaBuffer = await this.downloadMedia(media.id);

    await this.sendTextMessage(
      message.from,
      `Recibí tu ${mediaType === 'image' ? 'imagen' : mediaType === 'video' ? 'video' : mediaType === 'audio' ? 'audio' : 'documento'}. Para continuar necesito una instrucción en texto (ej. "Pagar 1250" o "Agendar cita").`,
      { tenant },
    );
  }

  /**
   * Maneja mensajes de ubicación
   */
  private async handleLocationMessage(
    message: WhatsAppIncomingMessage,
    tenant: TenantContext,
  ): Promise<void> {
    if (!message.location) return;

    this.logger.log(
      `Ubicación recibida - Lat: ${message.location.latitude}, Lng: ${message.location.longitude}`,
    );

    if (message.location.name) {
      this.logger.log(`Nombre del lugar: ${message.location.name}`);
    }

    await this.sendTextMessage(
      message.from,
      'Ubicación recibida. Confírmame en texto cómo deseas usarla y la enrutamos al agente correspondiente.',
      { tenant },
    );
  }

  /**
   * Maneja mensajes interactivos (botones, listas)
   */
  private async handleInteractiveMessage(
    message: WhatsAppIncomingMessage,
    tenant: TenantContext,
  ): Promise<void> {
    if (!message.interactive) return;

    if (message.interactive.button_reply) {
      this.logger.log(
        `Botón seleccionado - ID: ${message.interactive.button_reply.id}, Título: ${message.interactive.button_reply.title}`,
      );

      await this.sendTextMessage(
        message.from,
        `Seleccionaste ${message.interactive.button_reply.title}. Escríbeme en texto qué operación deseas (cita, pagar, reporte o token).`,
        { tenant },
      );
    } else if (message.interactive.list_reply) {
      this.logger.log(
        `Opción de lista seleccionada - ID: ${message.interactive.list_reply.id}, Título: ${message.interactive.list_reply.title}`,
      );

      await this.sendTextMessage(
        message.from,
        `Seleccionaste ${message.interactive.list_reply.title}. Continúa en texto para completar la solicitud.`,
        { tenant },
      );
    }
  }

  /**
   * Maneja mensajes de botón (tipo button)
   */
  private async handleButtonMessage(
    message: WhatsAppIncomingMessage,
    tenant: TenantContext,
  ): Promise<void> {
    this.logger.log('Botón presionado en el mensaje');
    // La lógica específica depende del tipo de botón
    // Este caso es similar a interactive pero para el tipo 'button'
    await this.sendTextMessage(
      message.from,
      'Recibí tu selección. Envíame la instrucción en texto para activarla en el orquestador.',
      { tenant },
    );
  }

  /**
   * Maneja los estados de los mensajes
   */
  private handleMessageStatus(status: WhatsAppStatus): void {
    this.logger.log(
      `Estado del mensaje ${status.id}: ${status.status} - Destinatario: ${status.recipient_id}`,
    );
  }

  private isDuplicateMessage(messageId: string | undefined): boolean {
    if (!messageId) {
      return false;
    }

    const now = Date.now();
    this.pruneProcessedMessages(now);

    if (this.processedMessageCache.has(messageId)) {
      return true;
    }

    this.processedMessageCache.set(messageId, now);
    return false;
  }

  private pruneProcessedMessages(reference: number): void {
    for (const [id, timestamp] of this.processedMessageCache.entries()) {
      if (reference - timestamp > this.processedMessageTtlMs) {
        this.processedMessageCache.delete(id);
      }
    }
  }

  private resolveContactWaId(
    contacts: WhatsAppContact[] | undefined,
    messageFrom: string,
  ): string | undefined {
    if (!contacts?.length) {
      return undefined;
    }

    const match = contacts.find((contact) => contact.wa_id === messageFrom);
    return match?.wa_id ?? contacts[0]?.wa_id;
  }

  private buildTenantContext(phoneNumberId?: string): TenantContext {
    const resolvedPhoneId = phoneNumberId ?? this.defaultPhoneNumberId;
    return {
      companyId: 'pasatanda-default',
      companyName: 'PasaTanda',
      companyConfig: {},
      phoneNumberId: resolvedPhoneId,
      adminPhoneIds: [],
    };
  }

  private resolveRole(sender: string): UserRole {
    const admin = this.configService.get<string>('ADMIN_PHONE_NUMBER', '') || '';
    const cleanSender = sender.replace(/[^0-9+]/g, '');
    const cleanAdmin = admin.replace(/[^0-9+]/g, '');
    if (cleanAdmin && cleanSender.endsWith(cleanAdmin)) {
      return UserRole.ADMIN;
    }
    return UserRole.CLIENT;
  }

  private async dispatchAction(
    recipient: string,
    action: RouterAction,
    tenant: TenantContext,
  ): Promise<void> {
    switch (action.type) {
      case 'text':
        await this.sendTextMessage(recipient, action.text, { tenant });
        break;
      case 'image': {
        // Intentar subir a Pinata primero para obtener URL pública
        if (this.pinataService.isEnabled()) {
          const publicUrl = await this.pinataService.uploadImageFromBase64(
            action.base64,
            `qr-${Date.now()}.png`,
          );
          
          if (publicUrl) {
            // Enviar usando URL pública
            await this.sendImageMessageFromUrl(
              recipient,
              publicUrl,
              action.caption,
              { tenant },
            );
            break;
          }
          
          this.logger.warn('Pinata falló, usando fallback a upload directo');
        }
        
        // Fallback: subir imagen a Meta directamente
        const buffer = Buffer.from(action.base64, 'base64');
        const { phoneNumberId } = await this.resolvePhoneNumberId({ tenant });
        const mediaId = await this.uploadMedia(
          buffer,
          action.mimeType ?? 'image/png',
          `image-${Date.now()}.png`,
          phoneNumberId,
        );
        await this.sendImageMessage(
          recipient,
          mediaId,
          action.caption,
          { tenant },
        );
        break;
      }
      default: {
        const unsupportedType = (action as { type: string }).type;
        this.logger.warn(`Acción no soportada: ${unsupportedType}`);
        break;
      }
    }
  }

  /**
   * Envía un mensaje de texto
   */
  async sendTextMessage(
    to: string,
    text: string,
    options?: MessageContextOptions,
  ): Promise<any> {
    this.logger.debug(`Preparando mensaje de texto para ${to}`);
    const messageData: SendMessageDto = {
      to,
      type: 'text',
      text: {
        preview_url: false,
        body: text,
      },
    };

    const result = await this.sendMessage(messageData, options);
    this.logger.log(`✉️  Mensaje de texto enviado a ${to}`);
    return result;
  }

  /**
   * Envía un mensaje con imagen
   */
  async sendImageMessage(
    to: string,
    imageUrl: string,
    caption?: string,
    options?: MessageContextOptions,
  ): Promise<any> {
    const messageData: SendMessageDto = {
      to,
      type: 'image',
      image: {
        link: imageUrl,
        caption,
      },
    };

    return this.sendMessage(messageData, options);
  }

  /**
   * Envía un mensaje con imagen desde URL pública
   */
  async sendImageMessageFromUrl(
    to: string,
    imageUrl: string,
    caption?: string,
    options?: MessageContextOptions,
  ): Promise<any> {
    const messageData: SendMessageDto = {
      to,
      type: 'image',
      image: {
        link: imageUrl,
        caption,
      },
    };

    return this.sendMessage(messageData, options);
  }

  async sendImageFromBase64(
    to: string,
    base64: string,
    mimeType: string = 'image/png',
    caption?: string,
    options?: MessageContextOptions,
  ): Promise<any> {
    const { phoneNumberId } = await this.resolvePhoneNumberId(options);
    const buffer = Buffer.from(base64, 'base64');
    const mediaId = await this.uploadMedia(
      buffer,
      mimeType,
      `qr-${Date.now()}.png`,
      phoneNumberId,
    );

    const messageData: SendMessageDto = {
      to,
      type: 'image',
      image: {
        id: mediaId,
        caption,
      },
    };

    return this.sendMessage(messageData, {
      ...options,
      phoneNumberId,
    });
  }

  /**
   * Envía un mensaje con video
   */
  async sendVideoMessage(
    to: string,
    videoUrl: string,
    caption?: string,
    options?: MessageContextOptions,
  ): Promise<any> {
    const messageData: SendMessageDto = {
      to,
      type: 'video',
      video: {
        link: videoUrl,
        caption,
      },
    };

    return this.sendMessage(messageData, options);
  }

  /**
   * Envía un mensaje con documento
   */
  async sendDocumentMessage(
    to: string,
    documentUrl: string,
    filename: string,
    caption?: string,
    options?: MessageContextOptions,
  ): Promise<any> {
    const messageData: SendMessageDto = {
      to,
      type: 'document',
      document: {
        link: documentUrl,
        filename,
        caption,
      },
    };

    return this.sendMessage(messageData, options);
  }

  /**
   * Envía un mensaje usando plantilla
   */
  async sendTemplateMessage(
    to: string,
    templateName: string,
    languageCode: string = 'es',
    components?: any[],
    options?: MessageContextOptions,
  ): Promise<any> {
    const messageData: SendMessageDto = {
      to,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: languageCode,
        },
        components,
      },
    };

    return this.sendMessage(messageData, options);
  }

  /**
   * Envía un mensaje interactivo CTA URL (Call-to-Action con botón de enlace).
   * Ideal para enviar QR de pago con botón para abrir la página de pago.
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-cta-url-messages
   */
  async sendInteractiveCtaUrlMessage(
    to: string,
    params: {
      headerImageUrl?: string;
      headerImageId?: string;
      bodyText: string;
      footerText?: string;
      buttonDisplayText: string;
      buttonUrl: string;
    },
    options?: MessageContextOptions,
  ): Promise<any> {
    const { phoneNumberId } = await this.resolvePhoneNumberId(options);

    // Construir el header (imagen opcional)
    let header: Record<string, unknown> | undefined;
    if (params.headerImageUrl) {
      header = {
        type: 'image',
        image: {
          link: params.headerImageUrl,
        },
      };
    } else if (params.headerImageId) {
      header = {
        type: 'image',
        image: {
          id: params.headerImageId,
        },
      };
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        ...(header && { header }),
        body: {
          text: params.bodyText,
        },
        ...(params.footerText && {
          footer: {
            text: params.footerText,
          },
        }),
        action: {
          name: 'cta_url',
          parameters: {
            display_text: params.buttonDisplayText,
            url: params.buttonUrl,
          },
        },
      },
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post(this.getMessagesEndpoint(phoneNumberId), payload, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiToken}`,
          },
        }),
      );

      this.logger.log(`Mensaje interactivo CTA URL enviado a ${to}`);
      return response.data;
    } catch (error) {
      const safeError = error as Error & { response?: { data?: unknown } };
      const details = safeError.response?.data ?? safeError.message;
      this.logger.error('Error enviando mensaje interactivo CTA URL:', details);
      throw safeError;
    }
  }

  /**
   * Envía un mensaje interactivo CTA URL con imagen QR desde base64.
   * CRÍTICO: WhatsApp requiere URL pública para el header de imagen, NO media ID.
   * Primero sube a Pinata Cloud para obtener URL pública permanente.
   */
  async sendInteractiveCtaUrlWithQr(
    to: string,
    params: {
      qrBase64: string;
      mimeType?: string;
      bodyText: string;
      footerText?: string;
      buttonDisplayText: string;
      buttonUrl: string;
    },
    options?: MessageContextOptions,
  ): Promise<any> {
    this.logger.debug(`Preparando mensaje CTA con QR para ${to}`);

    // Intentar subir a Pinata para obtener URL pública (requerido por WhatsApp)
    let qrImageUrl: string | null = null;
    
    if (this.pinataService.isEnabled()) {
      try {
        this.logger.debug('Subiendo QR a Pinata Cloud...');
        qrImageUrl = await this.pinataService.uploadImageFromBase64(
          params.qrBase64,
          `qr-payment-${Date.now()}.png`,
        );
        this.logger.log(`QR subido exitosamente a Pinata: ${qrImageUrl}`);
      } catch (error) {
        this.logger.error('Error subiendo QR a Pinata:', error);
      }
    } else {
      this.logger.warn('Pinata no está configurado, no se puede enviar QR en header');
    }

    // Si no hay URL del QR, enviar mensaje sin header de imagen
    if (!qrImageUrl) {
      this.logger.warn(
        'No se pudo obtener URL pública del QR. Enviando mensaje CTA sin imagen en header.',
      );
      return this.sendInteractiveCtaUrlMessage(
        to,
        {
          bodyText: params.bodyText,
          footerText: params.footerText,
          buttonDisplayText: params.buttonDisplayText,
          buttonUrl: params.buttonUrl,
        },
        options,
      );
    }

    // Enviar mensaje interactivo con URL pública del QR en header
    return this.sendInteractiveCtaUrlMessage(
      to,
      {
        headerImageUrl: qrImageUrl,
        bodyText: params.bodyText,
        footerText: params.footerText,
        buttonDisplayText: params.buttonDisplayText,
        buttonUrl: params.buttonUrl,
      },
      options,
    );
  }

  /**
   * Método genérico para enviar mensajes
   */
  private async sendMessage(
    messageData: SendMessageDto,
    options?: MessageContextOptions,
  ): Promise<any> {
    try {
      const { phoneNumberId } = await this.resolvePhoneNumberId(options);
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        ...messageData,
      };

      const response = await firstValueFrom(
        this.httpService.post(
          this.getMessagesEndpoint(phoneNumberId),
          payload,
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiToken}`,
            },
          },
        ),
      );

      this.logger.log(`Mensaje enviado correctamente a ${messageData.to}`);
      return response.data;
    } catch (error) {
      const safeError = error as Error & { response?: { data?: unknown } };
      const details = safeError.response?.data ?? safeError.message;
      this.logger.error('Error enviando mensaje:', details);
      throw safeError;
    }
  }

  private async uploadMedia(
    buffer: Buffer,
    mimeType: string,
    filename: string,
    phoneNumberId: string,
  ): Promise<string> {
    try {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('file', buffer, {
        filename,
        contentType: mimeType,
      });

      const response = await firstValueFrom(
        this.httpService.post(this.getMediaEndpoint(phoneNumberId), form, {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            ...form.getHeaders(),
          },
        }),
      );

      const mediaId = (response.data as { id?: string }).id;
      if (!mediaId) {
        throw new Error('No se recibió ID de media tras la carga');
      }

      return mediaId;
    } catch (error) {
      const safeError = error as Error & { response?: { data?: unknown } };
      const details = safeError.response?.data ?? safeError.message;
      this.logger.error('Error subiendo media a WhatsApp:', details);
      throw safeError;
    }
  }

  private getMessagesEndpoint(phoneNumberId: string): string {
    return `https://graph.facebook.com/${this.apiVersion}/${phoneNumberId}/messages`;
  }

  private getMediaEndpoint(phoneNumberId: string): string {
    return `https://graph.facebook.com/${this.apiVersion}/${phoneNumberId}/media`;
  }

  private async resolvePhoneNumberId(
    options?: MessageContextOptions,
  ): Promise<{ phoneNumberId: string; tenant?: TenantContext }> {
    if (options?.tenant?.phoneNumberId) {
      return {
        phoneNumberId: options.tenant.phoneNumberId,
        tenant: options.tenant,
      };
    }

    if (options?.phoneNumberId) {
      return {
        phoneNumberId: options.phoneNumberId,
        tenant: options.tenant,
      };
    }

    if (this.defaultPhoneNumberId) {
      return { phoneNumberId: this.defaultPhoneNumberId, tenant: this.buildTenantContext(this.defaultPhoneNumberId) };
    }

    throw new Error(
      'No se pudo determinar el phone_number_id para enviar el mensaje.',
    );
  }

  /**
   * Marca un mensaje como leído
   */
  private async markAsRead(
    messageId: string,
    tenant: TenantContext,
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.httpService.post(
          this.getMessagesEndpoint(tenant.phoneNumberId),
          {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiToken}`,
            },
          },
        ),
      );

      this.logger.log(`Mensaje ${messageId} marcado como leído`);
    } catch (error) {
      const safeError = error as Error & { response?: { data?: unknown } };
      const details = safeError.response?.data ?? safeError.message;
      this.logger.error('Error marcando mensaje como leído:', details);
    }
  }

  /**
   * Descarga un medio (imagen, video, audio, documento)
   */
  async downloadMedia(mediaId: string): Promise<Buffer> {
    try {
      // Primero obtener la URL del medio
      const mediaUrlResponse = await firstValueFrom(
        this.httpService.get(
          `https://graph.facebook.com/${this.apiVersion}/${mediaId}`,
          {
            headers: {
              Authorization: `Bearer ${this.apiToken}`,
            },
          },
        ),
      );
      const mediaUrl = (mediaUrlResponse.data as { url?: string })?.url;
      if (!mediaUrl) {
        throw new Error('No se pudo obtener la URL del recurso solicitado');
      }

      // Descargar el medio
      const mediaResponse = await firstValueFrom(
        this.httpService.get<ArrayBuffer>(mediaUrl, {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
          },
          responseType: 'arraybuffer',
        }),
      );

      return Buffer.from(mediaResponse.data);
    } catch (error) {
      const safeError = error as Error & { response?: { data?: unknown } };
      const details = safeError.response?.data ?? safeError.message;
      this.logger.error('Error descargando medio:', details);
      throw safeError;
    }
  }
}
