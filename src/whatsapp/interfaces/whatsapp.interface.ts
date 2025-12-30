export interface WhatsAppMessage {
  object: string;
  entry: WhatsAppEntry[];
}

export interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

export interface WhatsAppChange {
  value: WhatsAppValue;
  field: string;
}

export interface WhatsAppValue {
  messaging_product: string;
  metadata: WhatsAppMetadata;
  contacts?: WhatsAppContact[];
  messages?: WhatsAppIncomingMessage[];
  statuses?: WhatsAppStatus[];
}

export interface WhatsAppMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

export interface WhatsAppContact {
  profile: {
    name: string;
  };
  wa_id: string;
  identity_key_hash?: string; // Solo si la verificación de cambio de identidad está habilitada
}

export interface WhatsAppIncomingMessage {
  from: string;
  id: string;
  timestamp: string;
  group?: {
    id: string;
    subject?: string;
  };
  type:
    | 'text'
    | 'image'
    | 'video'
    | 'audio'
    | 'document'
    | 'location'
    | 'contacts'
    | 'interactive'
    | 'button'
    | 'sticker'
    | 'reaction'
    | 'order'
    | 'system'
    | 'unsupported';
  text?: {
    body: string;
  };
  image?: {
    caption?: string;
    mime_type: string;
    sha256: string;
    id: string;
  };
  video?: {
    caption?: string;
    mime_type: string;
    sha256: string;
    id: string;
  };
  audio?: {
    mime_type: string;
    sha256: string;
    id: string;
    voice: boolean;
  };
  document?: {
    caption?: string;
    filename: string;
    mime_type: string;
    sha256: string;
    id: string;
  };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  interactive?: {
    type: string;
    button_reply?: {
      id: string;
      title: string;
    };
    list_reply?: {
      id: string;
      title: string;
      description?: string;
    };
  };
  // Context - Solo presente si el mensaje se originó desde un botón "Message business"
  // o si es una respuesta/reenvío
  context?: {
    from: string;
    id: string;
    referred_product?: {
      catalog_id: string;
      product_retailer_id: string;
    };
  };
  // Referral - Solo presente si el mensaje proviene de un anuncio de clic a WhatsApp
  referral?: {
    source_url: string;
    source_id: string;
    source_type: 'ad' | 'post';
    headline: string;
    body: string;
    media_type: 'image' | 'video';
    image_url?: string;
    video_url?: string;
    thumbnail_url?: string;
    ctwa_clid?: string; // Se omite para anuncios en el estado de WhatsApp
    welcome_message?: {
      text: string;
    };
  };
  // Errors - Solo presente en mensajes de tipo "unsupported"
  errors?: Array<{
    code: number;
    title: string;
    message?: string;
    error_data?: {
      details: string;
    };
  }>;
}

export interface WhatsAppStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  conversation?: {
    id: string;
    origin: {
      type: string;
    };
  };
  pricing?: {
    billable: boolean;
    pricing_model: string;
    category: string;
  };
}

export interface SendMessageDto {
  to: string;
  type: 'text' | 'template' | 'image' | 'video' | 'audio' | 'document';
  text?: {
    preview_url?: boolean;
    body: string;
  };
  template?: {
    name: string;
    language: {
      code: string;
    };
    components?: any[];
  };
  image?: {
    link?: string;
    caption?: string;
    id?: string;
  };
  video?: {
    link?: string;
    caption?: string;
    id?: string;
  };
  audio?: {
    link?: string;
    id?: string;
  };
  document?: {
    link?: string;
    caption?: string;
    filename?: string;
    id?: string;
  };
}
