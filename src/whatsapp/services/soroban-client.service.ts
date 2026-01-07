import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface CreateGroupParams {
  members: string[];
  amountStroops: string;
  frequencyDays: number;
  enableYield: boolean;
  yieldShareBps: number;
}

@Injectable()
export class SorobanClientService {
  private readonly logger = new Logger(SorobanClientService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly treasuryAddress: string;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.baseUrl = config.get<string>(
      'PAYMENT_BACKEND_URL',
      'http://localhost:3000',
    );
    this.apiKey = config.get<string>('PAYMENT_API_KEY', '');
    this.treasuryAddress = config.get<string>('SOROBAN_TREASURY_ADDRESS', '');
  }

  async createGroup(
    params: CreateGroupParams,
  ): Promise<{ address?: string; raw?: unknown }> {
    const url = `${this.baseUrl}/api/soroban/groups`;
    const payload = {
      amountPerRound: params.amountStroops,
      frequencyDays: params.frequencyDays,
      members: params.members,
      enableYield: params.enableYield,
      yieldShareBps: params.yieldShareBps,
    };
    try {
      this.logRequest('POST', url, payload);
      const response = await firstValueFrom(
        this.http.post(url, payload, { headers: this.buildHeaders() }),
      );
      const data: unknown = response.data;
      this.logResponse('POST', url, data);
      const address = this.pickString(data, ['groupAddress', 'address']);
      return { address, raw: data };
    } catch (error) {
      this.logger.error(
        `No se pudo crear grupo Soroban: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  async payout(
    groupAddress: string,
    winner: string,
  ): Promise<{ txHash?: string }> {
    const url = `${this.baseUrl}/api/soroban/groups/${groupAddress}/payout`;
    const payload = { winner };
    try {
      this.logRequest('POST', url, payload);
      const response = await firstValueFrom(
        this.http.post(url, payload, { headers: this.buildHeaders() }),
      );
      this.logResponse('POST', url, response.data);
      const txHash = this.pickString(response.data, ['txHash', 'tx_hash']);
      return { txHash };
    } catch (error) {
      this.logger.error(
        `No se pudo cerrar ronda Soroban: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  async sweepYield(groupAddress: string): Promise<{ txHash?: string }> {
    const url = `${this.baseUrl}/api/soroban/groups/${groupAddress}/sweep-yield`;
    if (!this.treasuryAddress) {
      throw new Error('SOROBAN_TREASURY_ADDRESS no está configurado');
    }
    const payload = { treasuryAddress: this.treasuryAddress };
    try {
      this.logRequest('POST', url, payload);
      const response = await firstValueFrom(
        this.http.post(url, payload, { headers: this.buildHeaders() }),
      );
      this.logResponse('POST', url, response.data);
      const txHash = this.pickString(response.data, ['txHash', 'tx_hash']);
      return { txHash };
    } catch (error) {
      this.logger.error(
        `No se pudo barrer el yield Soroban: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  private logRequest(method: string, url: string, payload: unknown): void {
    this.logger.debug(`Solicitud ${method} ${url}: ${JSON.stringify(payload)}`);
  }

  private logResponse(method: string, url: string, payload: unknown): void {
    this.logger.debug(`Respuesta ${method} ${url}: ${JSON.stringify(payload)}`);
  }

  private pickString(data: unknown, keys: string[]): string | undefined {
    if (!data || typeof data !== 'object') {
      return undefined;
    }
    const record = data as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    return undefined;
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
