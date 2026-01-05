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
    payTo: string;
    details?: string;
    resource?: string;
  }): Promise<PayNegotiationResponse> {
    const url = new URL('/api/pay', this.baseUrl);
    url.searchParams.set('orderId', params.orderId);
    url.searchParams.set('amountUsd', String(params.amountUsd));
    url.searchParams.set('payTo', params.payTo);
    if (params.details) {
      url.searchParams.set('details', params.details);
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
    proofMetadata: Record<string, unknown>;
    jobId?: string;
  }): Promise<PayVerificationResponse> {
    const url = new URL('/api/pay', this.baseUrl);
    url.searchParams.set('orderId', params.orderId);
    if (params.jobId) {
      url.searchParams.set('jobId', params.jobId);
    }

    const xPaymentPayload = Buffer.from(
      JSON.stringify({
        x402Version: 1,
        type: 'fiat',
        payload: params.proofMetadata,
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
    xPayment: string;
  }): Promise<PayVerificationResponse> {
    const url = new URL('/api/pay', this.baseUrl);
    url.searchParams.set('orderId', params.orderId);

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
}
