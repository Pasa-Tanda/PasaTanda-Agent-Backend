import type { WhatsAppIncomingMessage } from './interfaces/whatsapp.interface';

export enum UserRole {
  ADMIN = 'ROLE_ADMIN',
  CLIENT = 'ROLE_CLIENT',
}

export enum Intent {
  BOOKING = 'INTENT_BOOKING',
  SHOPPING = 'INTENT_SHOPPING',
  REPORTING = 'INTENT_REPORTING',
  TWO_FA = 'INTENT_2FA_REPLY',
}

export type PasatandaIntent =
  | 'PAY_QUOTA'
  | 'CHECK_STATUS'
  | 'CREATE_GROUP'
  | 'START_TANDA'
  | 'UPLOAD_PROOF'
  | 'UNKNOWN';

export enum PaymentState {
  CART = 'STATE_CART',
  AWAITING_QR = 'STATE_AWAITING_QR',
  QR_SENT = 'STATE_QR_SENT',
  VERIFYING = 'STATE_VERIFYING',
  COMPLETED = 'STATE_COMPLETED',
}

export interface SanitizationToken {
  placeholder: string;
  rawValue: string;
  kind: 'phone' | 'email' | 'name' | 'address';
}

export interface SanitizedTextResult {
  sanitizedText: string;
  normalizedText: string;
  tokens: SanitizationToken[];
}

export interface AdkSessionSnapshot {
  sessionId: string;
  companyId: string;
  senderId: string;
  context: Record<string, unknown>;
}

/**
 * Información del producto referenciado desde WhatsApp (cuando el usuario
 * envía un mensaje preguntando por un producto específico del catálogo).
 */
export interface ReferredProduct {
  catalogId: string;
  productRetailerId: string;
}

export interface RouterMessageContext {
  senderId: string;
  whatsappMessageId: string;
  originalText: string;
  message: WhatsAppIncomingMessage;
  phoneNumberId?: string;
  role: UserRole;
  groupId?: string;
  adkSession?: AdkSessionSnapshot;
  /** Producto referenciado si el mensaje viene de un producto del catálogo */
  referredProduct?: ReferredProduct;
}

export type RouterAction =
  | {
      type: 'text';
      text: string;
      to?: string;
    }
  | {
      type: 'image';
      base64: string;
      caption?: string;
      mimeType?: string;
      to?: string;
    };

export interface AgentResponse {
  actions: RouterAction[];
  metadata?: Record<string, unknown>;
}

export interface RouterResult extends AgentResponse {
  role: UserRole;
  intent: Intent | 'FALLBACK';
  sanitized: SanitizedTextResult;
}

/**
 * Datos de negociación x402 almacenados en la orden
 */
export interface X402NegotiationData {
  x402Version: number;
  resource: string;
  accepts: Array<{
    type: 'fiat' | 'crypto';
    currency?: string;
    symbol?: string;
    amountRequired?: number;
    base64QrSimple?: string;
  }>;
  jobId: string;
}

/**
 * Datos de settlement x402 almacenados en la orden
 */
export interface X402SettlementData {
  success: boolean;
  type: 'fiat' | 'crypto';
  transaction?: string | null;
  currency?: string;
  errorReason?: string | null;
}

export interface ChatHistoryItem {
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

export interface PaymentOrder {
  orderId: string;
  clientPhone: string;
  state: PaymentState;
  amount?: number;
  details: string;
  awaitingTwoFa?: boolean;
  lastUpdate: Date;
  companyId: string;
  supabaseOrderId?: string;
  userId?: string;
  /** Job ID de x402 para tracking del pago */
  x402JobId?: string;
  /** URL de pago generada (MAIN_PAGE_URL + orderId) */
  paymentUrl?: string;
  /** Respuesta de negociación x402 (opciones de pago) */
  x402Negotiation?: X402NegotiationData;
  /** Respuesta de settlement x402 (resultado del pago) */
  x402Settlement?: X402SettlementData;
  /** product_retailer_id referenciado desde WhatsApp */
  referredProductId?: string;
  /** catalog_id referenciado desde WhatsApp */
  referredCatalogId?: string;
  /** Historial de chat para contexto de Gemini */
  chatHistory?: ChatHistoryItem[];
}

export enum SalesToolType {
  SYNC_INVENTORY_TO_META = 'sync_inventory_to_meta',
  SYNC_INVENTORY_FROM_META = 'sync_inventory_from_meta',
  SEARCH_PRODUCTS = 'search_products',
  GET_PRODUCT_INFO = 'get_product_info',
  UPDATE_PRODUCT_AVAILABILITY = 'update_product_availability',
  LIST_ALL_PRODUCTS = 'list_all_products',
}

export interface SalesToolResult {
  success: boolean;
  data?: any;
  error?: string;
  message?: string;
}
