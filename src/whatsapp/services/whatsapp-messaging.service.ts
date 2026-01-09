import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import FormData from 'form-data';

/**
 * Tipos de mensajes de WhatsApp soportados según la documentación oficial:
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
 */

export interface WhatsAppMessageResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

export interface WhatsAppTemplateComponent {
  type: 'header' | 'body' | 'button';
  parameters?: Array<{
    type: 'text' | 'currency' | 'date_time' | 'image' | 'document' | 'video';
    text?: string;
    currency?: { fallback_value: string; code: string; amount_1000: number };
    date_time?: { fallback_value: string };
    image?: { link: string };
    document?: { link: string; filename?: string };
    video?: { link: string };
  }>;
  sub_type?: 'url' | 'quick_reply';
  index?: number;
}

export interface WhatsAppInteractiveButton {
  type: 'reply';
  reply: {
    id: string;
    title: string;
  };
}

export interface WhatsAppInteractiveListSection {
  title: string;
  rows: Array<{
    id: string;
    title: string;
    description?: string;
  }>;
}

export interface WhatsAppInteractiveProduct {
  product_retailer_id: string;
}

export interface WhatsAppContact {
  name: {
    formatted_name: string;
    first_name?: string;
    last_name?: string;
    middle_name?: string;
  };
  phones?: Array<{
    phone: string;
    type?: 'CELL' | 'MAIN' | 'IPHONE' | 'HOME' | 'WORK';
  }>;
  emails?: Array<{
    email: string;
    type?: 'WORK' | 'HOME';
  }>;
  addresses?: Array<{
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    country_code?: string;
    type?: 'HOME' | 'WORK';
  }>;
  org?: {
    company?: string;
    department?: string;
    title?: string;
  };
  urls?: Array<{
    url: string;
    type?: 'HOME' | 'WORK';
  }>;
  birthday?: string; // YYYY-MM-DD
}

export interface WhatsAppLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

/**
 * Servicio para enviar diferentes tipos de mensajes de WhatsApp.
 * Implementa la API de WhatsApp Cloud según la documentación oficial.
 */
@Injectable()
export class WhatsAppMessagingService {
  private readonly logger = new Logger(WhatsAppMessagingService.name);
  private readonly apiVersion: string;
  private readonly apiToken: string;
  private readonly defaultPhoneNumberId: string;

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {
    this.apiVersion = this.config.get<string>('WHATSAPP_API_VERSION', 'v21.0');
    this.apiToken = this.config.get<string>('META_API_TOKEN', '');
    this.defaultPhoneNumberId =
      this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID', '') ||
      this.config.get<string>('PHONE_NUMBER_ID', '');
  }

  /**
   * Construye la URL base para la API de WhatsApp
   */
  private getApiUrl(phoneNumberId?: string): string {
    const id = phoneNumberId || this.defaultPhoneNumberId;
    return `https://graph.facebook.com/${this.apiVersion}/${id}/messages`;
  }

  /**
   * Headers comunes para las peticiones
   */
  private getHeaders() {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  // =========================================================================
  // MENSAJE DE TEXTO
  // =========================================================================
  async sendText(
    to: string,
    text: string,
    options?: {
      phoneNumberId?: string;
      previewUrl?: boolean;
      replyToMessageId?: string;
    },
  ): Promise<WhatsAppMessageResponse> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        body: text,
        preview_url: options?.previewUrl ?? false,
      },
    };

    if (options?.replyToMessageId) {
      payload.context = { message_id: options.replyToMessageId };
    }

    return this.sendMessage(payload, options?.phoneNumberId);
  }

  // =========================================================================
  // MENSAJE CON IMAGEN
  // =========================================================================
  async sendImage(
    to: string,
    imageSource: { link?: string; id?: string },
    options?: {
      phoneNumberId?: string;
      caption?: string;
      replyToMessageId?: string;
    },
  ): Promise<WhatsAppMessageResponse> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'image',
      image: {
        ...(imageSource.link && { link: imageSource.link }),
        ...(imageSource.id && { id: imageSource.id }),
        ...(options?.caption && { caption: options.caption }),
      },
    };

    if (options?.replyToMessageId) {
      payload.context = { message_id: options.replyToMessageId };
    }

    return this.sendMessage(payload, options?.phoneNumberId);
  }

  // =========================================================================
  // MENSAJE CON DOCUMENTO
  // =========================================================================
  async sendDocument(
    to: string,
    documentSource: { link?: string; id?: string },
    options?: {
      phoneNumberId?: string;
      caption?: string;
      filename?: string;
      replyToMessageId?: string;
    },
  ): Promise<WhatsAppMessageResponse> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'document',
      document: {
        ...(documentSource.link && { link: documentSource.link }),
        ...(documentSource.id && { id: documentSource.id }),
        ...(options?.caption && { caption: options.caption }),
        ...(options?.filename && { filename: options.filename }),
      },
    };

    if (options?.replyToMessageId) {
      payload.context = { message_id: options.replyToMessageId };
    }

    return this.sendMessage(payload, options?.phoneNumberId);
  }

  // =========================================================================
  // MENSAJE CON VIDEO
  // =========================================================================
  async sendVideo(
    to: string,
    videoSource: { link?: string; id?: string },
    options?: {
      phoneNumberId?: string;
      caption?: string;
      replyToMessageId?: string;
    },
  ): Promise<WhatsAppMessageResponse> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'video',
      video: {
        ...(videoSource.link && { link: videoSource.link }),
        ...(videoSource.id && { id: videoSource.id }),
        ...(options?.caption && { caption: options.caption }),
      },
    };

    if (options?.replyToMessageId) {
      payload.context = { message_id: options.replyToMessageId };
    }

    return this.sendMessage(payload, options?.phoneNumberId);
  }

  // =========================================================================
  // MENSAJE CON AUDIO
  // =========================================================================
  async sendAudio(
    to: string,
    audioSource: { link?: string; id?: string },
    options?: {
      phoneNumberId?: string;
      replyToMessageId?: string;
    },
  ): Promise<WhatsAppMessageResponse> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'audio',
      audio: {
        ...(audioSource.link && { link: audioSource.link }),
        ...(audioSource.id && { id: audioSource.id }),
      },
    };

    if (options?.replyToMessageId) {
      payload.context = { message_id: options.replyToMessageId };
    }

    return this.sendMessage(payload, options?.phoneNumberId);
  }

  // =========================================================================
  // MENSAJE CON STICKER
  // =========================================================================
  async sendSticker(
    to: string,
    stickerSource: { link?: string; id?: string },
    options?: {
      phoneNumberId?: string;
      replyToMessageId?: string;
    },
  ): Promise<WhatsAppMessageResponse> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'sticker',
      sticker: {
        ...(stickerSource.link && { link: stickerSource.link }),
        ...(stickerSource.id && { id: stickerSource.id }),
      },
    };

    if (options?.replyToMessageId) {
      payload.context = { message_id: options.replyToMessageId };
    }

    return this.sendMessage(payload, options?.phoneNumberId);
  }

  // =========================================================================
  // MENSAJE CON UBICACIÓN
  // =========================================================================
  async sendLocation(
    to: string,
    location: WhatsAppLocation,
    options?: {
      phoneNumberId?: string;
      replyToMessageId?: string;
    },
  ): Promise<WhatsAppMessageResponse> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'location',
      location: {
        latitude: location.latitude,
        longitude: location.longitude,
        ...(location.name && { name: location.name }),
        ...(location.address && { address: location.address }),
      },
    };

    if (options?.replyToMessageId) {
      payload.context = { message_id: options.replyToMessageId };
    }

    return this.sendMessage(payload, options?.phoneNumberId);
  }

  // =========================================================================
  // MENSAJE CON CONTACTOS
  // =========================================================================
  async sendContacts(
    to: string,
    contacts: WhatsAppContact[],
    options?: {
      phoneNumberId?: string;
      replyToMessageId?: string;
    },
  ): Promise<WhatsAppMessageResponse> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'contacts',
      contacts,
    };

    if (options?.replyToMessageId) {
      payload.context = { message_id: options.replyToMessageId };
    }

    return this.sendMessage(payload, options?.phoneNumberId);
  }

  // =========================================================================
  // MENSAJE INTERACTIVO CON BOTONES
  // =========================================================================
  async sendInteractiveButtons(
    to: string,
    body: string,
    buttons: WhatsAppInteractiveButton[],
    options?: {
      phoneNumberId?: string;
      header?:
        | { type: 'text'; text: string }
        | { type: 'image'; image: { link: string } };
      footer?: string;
      replyToMessageId?: string;
    },
  ): Promise<WhatsAppMessageResponse> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: { buttons },
        ...(options?.header && { header: options.header }),
        ...(options?.footer && { footer: { text: options.footer } }),
      },
    };

    if (options?.replyToMessageId) {
      payload.context = { message_id: options.replyToMessageId };
    }

    return this.sendMessage(payload, options?.phoneNumberId);
  }

  // =========================================================================
  // MENSAJE INTERACTIVO CON URL (CTA)
  // =========================================================================
  async sendInteractiveCTA(
    to: string,
    body: string,
    ctaUrl: string,
    buttonText: string,
    options?: {
      phoneNumberId?: string;
      header?:
        | { type: 'text'; text: string }
        | { type: 'image'; image: { link: string } };
      footer?: string;
      replyToMessageId?: string;
    },
  ): Promise<WhatsAppMessageResponse> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        body: { text: body },
        action: {
          name: 'cta_url',
          parameters: {
            display_text: buttonText,
            url: ctaUrl,
          },
        },
        ...(options?.header && { header: options.header }),
        ...(options?.footer && { footer: { text: options.footer } }),
      },
    };

    if (options?.replyToMessageId) {
      payload.context = { message_id: options.replyToMessageId };
    }

    return this.sendMessage(payload, options?.phoneNumberId);
  }

  // =========================================================================
  // MENSAJE INTERACTIVO CON LISTA
  // =========================================================================
  async sendInteractiveList(
    to: string,
    body: string,
    buttonText: string,
    sections: WhatsAppInteractiveListSection[],
    options?: {
      phoneNumberId?: string;
      header?: string;
      footer?: string;
      replyToMessageId?: string;
    },
  ): Promise<WhatsAppMessageResponse> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body },
        action: {
          button: buttonText,
          sections,
        },
        ...(options?.header && {
          header: { type: 'text', text: options.header },
        }),
        ...(options?.footer && { footer: { text: options.footer } }),
      },
    };

    if (options?.replyToMessageId) {
      payload.context = { message_id: options.replyToMessageId };
    }

    return this.sendMessage(payload, options?.phoneNumberId);
  }

  // =========================================================================
  // MENSAJE INTERACTIVO CON PRODUCTO (catálogo)
  // =========================================================================
  async sendProduct(
    to: string,
    catalogId: string,
    productRetailerId: string,
    options?: {
      phoneNumberId?: string;
      body?: string;
      footer?: string;
      replyToMessageId?: string;
    },
  ): Promise<WhatsAppMessageResponse> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'product',
        action: {
          catalog_id: catalogId,
          product_retailer_id: productRetailerId,
        },
        ...(options?.body && { body: { text: options.body } }),
        ...(options?.footer && { footer: { text: options.footer } }),
      },
    };

    if (options?.replyToMessageId) {
      payload.context = { message_id: options.replyToMessageId };
    }

    return this.sendMessage(payload, options?.phoneNumberId);
  }

  // =========================================================================
  // MENSAJE INTERACTIVO CON LISTA DE PRODUCTOS
  // =========================================================================
  async sendProductList(
    to: string,
    catalogId: string,
    sections: Array<{
      title: string;
      product_items: WhatsAppInteractiveProduct[];
    }>,
    options?: {
      phoneNumberId?: string;
      header?: string;
      body?: string;
      footer?: string;
      replyToMessageId?: string;
    },
  ): Promise<WhatsAppMessageResponse> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'product_list',
        action: {
          catalog_id: catalogId,
          sections,
        },
        ...(options?.header && {
          header: { type: 'text', text: options.header },
        }),
        ...(options?.body && { body: { text: options.body } }),
        ...(options?.footer && { footer: { text: options.footer } }),
      },
    };

    if (options?.replyToMessageId) {
      payload.context = { message_id: options.replyToMessageId };
    }

    return this.sendMessage(payload, options?.phoneNumberId);
  }

  // =========================================================================
  // MENSAJE CON PLANTILLA (Template)
  // =========================================================================
  async sendTemplate(
    to: string,
    templateName: string,
    languageCode: string,
    components?: WhatsAppTemplateComponent[],
    options?: {
      phoneNumberId?: string;
      replyToMessageId?: string;
    },
  ): Promise<WhatsAppMessageResponse> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components && { components }),
      },
    };

    if (options?.replyToMessageId) {
      payload.context = { message_id: options.replyToMessageId };
    }

    return this.sendMessage(payload, options?.phoneNumberId);
  }

  // =========================================================================
  // PLANTILLA ESPECÍFICA: payment_request
  // Usada para solicitar pagos de cuotas de tanda
  // =========================================================================
  async sendPaymentRequest(
    to: string,
    params: {
      month: string;
      totalAmount: string;
      exchangeRate: string;
      groupName: string;
      headerImageUrl?: string;
      paymentUrl?: string;
    },
    options?: {
      phoneNumberId?: string;
      replyToMessageId?: string;
    },
  ): Promise<WhatsAppMessageResponse> {
    const components: WhatsAppTemplateComponent[] = [];

    // Header con imagen (si está disponible)
    if (params.headerImageUrl) {
      components.push({
        type: 'header',
        parameters: [
          {
            type: 'image',
            image: { link: params.headerImageUrl },
          },
        ],
      });
    }

    // Body con los parámetros
    components.push({
      type: 'body',
      parameters: [
        { type: 'text', text: params.month },
        { type: 'text', text: params.totalAmount },
        { type: 'text', text: params.exchangeRate },
        { type: 'text', text: params.groupName },
      ],
    });

    // Botón con URL de pago (si está disponible)
    if (params.paymentUrl) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: 0,
        parameters: [{ type: 'text', text: params.paymentUrl }],
      });
    }

    return this.sendTemplate(to, 'payment_request', 'es', components, options);
  }

  // =========================================================================
  // MENSAJE DE REACCIÓN
  // =========================================================================
  async sendReaction(
    to: string,
    messageId: string,
    emoji: string,
    options?: {
      phoneNumberId?: string;
    },
  ): Promise<WhatsAppMessageResponse> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      reaction: {
        message_id: messageId,
        emoji,
      },
    };

    return this.sendMessage(payload, options?.phoneNumberId);
  }

  // =========================================================================
  // MARCAR MENSAJE COMO LEÍDO
  // =========================================================================
  async markAsRead(
    messageId: string,
    options?: {
      phoneNumberId?: string;
    },
  ): Promise<void> {
    const payload = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    };

    try {
      await firstValueFrom(
        this.http.post(this.getApiUrl(options?.phoneNumberId), payload, {
          headers: this.getHeaders(),
        }),
      );
      this.logger.debug(`Mensaje ${messageId} marcado como leído`);
    } catch (error) {
      this.logger.warn(
        `No se pudo marcar mensaje como leído: ${(error as Error).message}`,
      );
    }
  }

  // =========================================================================
  // MÉTODO INTERNO: Enviar mensaje genérico
  // =========================================================================
  private async sendMessage(
    payload: Record<string, unknown>,
    phoneNumberId?: string,
  ): Promise<WhatsAppMessageResponse> {
    try {
      const response = await firstValueFrom(
        this.http.post<WhatsAppMessageResponse>(
          this.getApiUrl(phoneNumberId),
          payload,
          { headers: this.getHeaders() },
        ),
      );

      this.logger.debug(`Mensaje enviado exitosamente a ${payload.to}`);
      return response.data;
    } catch (error) {
      const axiosError = error as {
        response?: { data?: unknown; status?: number };
        message: string;
      };

      this.logger.error(
        `Error enviando mensaje: ${axiosError.response?.status} - ${JSON.stringify(axiosError.response?.data ?? axiosError.message)}`,
      );
      throw error;
    }
  }

  // =========================================================================
  // SUBIR MEDIA (para obtener media_id)
  // =========================================================================
  async uploadMedia(
    buffer: Buffer,
    mimeType: string,
    filename: string,
    options?: {
      phoneNumberId?: string;
    },
  ): Promise<{ id: string }> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', buffer, { filename, contentType: mimeType });
    form.append('type', mimeType);

    const id = options?.phoneNumberId || this.defaultPhoneNumberId;
    const url = `https://graph.facebook.com/${this.apiVersion}/${id}/media`;

    const response = await firstValueFrom(
      this.http.post<{ id: string }>(url, form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${this.apiToken}`,
        },
      }),
    );

    return response.data;
  }
}
