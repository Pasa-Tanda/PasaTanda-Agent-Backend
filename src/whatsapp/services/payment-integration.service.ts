import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

interface PayNegotiationResponse {
  jobId?: string;
  accepts?: Array<Record<string, unknown>>;
  challenge?: string;
  qrBase64?: string;
  raw?: any;
}

interface PayVerificationResponse {
  success: boolean;
  txHash?: string;
  statusCode?: number;
  reason?: string;
  raw?: any;
}

@Injectable()
export class PaymentIntegrationService {
  private readonly logger = new Logger(PaymentIntegrationService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.baseUrl = config.get<string>(
      'PAYMENT_BACKEND_URL',
      'http://localhost:3000',
    );
    this.apiKey = config.get<string>('PAYMENT_API_KEY', '');
  }

  async negotiatePayment(params: {
    orderId: string;
    amountUsd: number;
    payTo?: string;
    description?: string;
    resource?: string;
  }): Promise<PayNegotiationResponse> {
    const url = new URL('/api/pay', this.baseUrl);
    url.searchParams.set('orderId', params.orderId);
    url.searchParams.set('amountUsd', String(params.amountUsd));

    // PayBE docs: payTo es opcional.
    if (params.payTo) {
      url.searchParams.set('payTo', params.payTo);
    }

    // PayBE docs: usa "description" (no "details").
    if (params.description) {
      url.searchParams.set('description', params.description);
    }
    if (params.resource) {
      url.searchParams.set('resource', params.resource);
    }

    try {
      const response = await firstValueFrom(
        this.http.get(url.toString(), {
          headers: this.buildHeaders(),
          validateStatus: () => true,
        }),
      );

      const data = response.data as any;
      const jobId = data?.jobId ?? data?.job_id ?? data?.jobID;
      const accepts = data?.accepts ?? data?.payments ?? [];
      const qrBase64 =
        data?.qr_image_base64 ?? data?.qrBase64 ?? data?.qr_payload_url;
      const challenge = data?.xdr ?? data?.challenge ?? data?.xdr_challenge;

      return {
        jobId,
        accepts,
        qrBase64,
        challenge,
        raw: data,
      };
    } catch (error) {
      this.logger.error(
        `No se pudo negociar pago para ${params.orderId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  async verifyFiat(params: {
    orderId: string;
    amountUsd: number;
    proofMetadata: Record<string, unknown>;
  }): Promise<PayVerificationResponse> {
    const url = new URL('/api/pay', this.baseUrl);
    url.searchParams.set('orderId', params.orderId);
    url.searchParams.set('amountUsd', String(params.amountUsd));

    const payload = this.buildStrictFiatPayload(params.orderId, params.proofMetadata);
    if (!payload) {
      return {
        success: false,
        statusCode: 400,
        reason:
          'proofMetadata inválido. Se requieren: glosa, time (ISO) y transactionId.',
        raw: null,
      };
    }

    const xPaymentPayload = Buffer.from(
      JSON.stringify({
        x402Version: 1,
        type: 'fiat',
        currency: payload.currency,
        payload: payload.payload,
      }),
      'utf8',
    ).toString('base64');

    try {
      const response = await firstValueFrom(
        this.http.get(url.toString(), {
          headers: {
            ...this.buildHeaders(),
            'X-PAYMENT': xPaymentPayload,
          },
          validateStatus: () => true,
        }),
      );

      const data = response.data as any;
      const success =
        response.status === 200 &&
        Boolean(data?.success ?? data?.verified ?? true);
      const txHash = data?.tx_hash ?? data?.transaction;

      return { success, txHash, statusCode: response.status, raw: data };
    } catch (error) {
      this.logger.error(
        `Error verificando pago de ${params.orderId}: ${(error as Error).message}`,
      );
      return { success: false, raw: null };
    }
  }

  async forwardCrypto(params: {
    orderId: string;
    amountUsd: number;
    xPayment: string;
  }): Promise<PayVerificationResponse> {
    const url = new URL('/api/pay', this.baseUrl);
    url.searchParams.set('orderId', params.orderId);
    url.searchParams.set('amountUsd', String(params.amountUsd));

    try {
      const response = await firstValueFrom(
        this.http.get(url.toString(), {
          headers: {
            ...this.buildHeaders(),
            'X-PAYMENT': params.xPayment,
          },
          validateStatus: () => true,
        }),
      );

      const data = response.data as any;
      const success = response.status === 200 && Boolean(data?.success ?? true);
      const txHash = data?.tx_hash ?? data?.transaction;
      return { success, txHash, raw: data };
    } catch (error) {
      this.logger.error(
        `Error reenviando pago crypto ${params.orderId}: ${(error as Error).message}`,
      );
      return { success: false, raw: null };
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['x-internal-api-key'] = this.apiKey;
    }
    return headers;
  }

  private buildStrictFiatPayload(
    orderId: string,
    proofMetadata: Record<string, unknown>,
  ):
    | { currency: string; payload: { glosa: string; time: string; transactionId: string } }
    | null {
    const currency =
      typeof (proofMetadata as any)?.currency === 'string'
        ? String((proofMetadata as any).currency)
        : 'BOB';

    const glosaRaw =
      typeof (proofMetadata as any)?.glosa === 'string'
        ? (proofMetadata as any).glosa
        : typeof (proofMetadata as any)?.details === 'string'
          ? (proofMetadata as any).details
          : typeof (proofMetadata as any)?.description === 'string'
            ? (proofMetadata as any).description
            : orderId;

    const timeRaw =
      typeof (proofMetadata as any)?.time === 'string'
        ? (proofMetadata as any).time
        : typeof (proofMetadata as any)?.date === 'string'
          ? (proofMetadata as any).date
          : new Date().toISOString();

    const transactionIdRaw =
      typeof (proofMetadata as any)?.transactionId === 'string'
        ? (proofMetadata as any).transactionId
        : typeof (proofMetadata as any)?.reference === 'string'
          ? (proofMetadata as any).reference
          : typeof (proofMetadata as any)?.transaction === 'string'
            ? (proofMetadata as any).transaction
            : undefined;

    if (!transactionIdRaw) {
      return null;
    }

    const payload = {
      glosa: String(glosaRaw),
      time: String(timeRaw),
      transactionId: String(transactionIdRaw),
    };

    return { currency, payload };
  }
}
