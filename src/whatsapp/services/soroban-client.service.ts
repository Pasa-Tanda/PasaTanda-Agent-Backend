import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface CreateGroupParams {
  members: string[];
  admin: string;
  amountStroops: string;
  frequencyDays: number;
  yieldEnabled?: boolean;
  yieldShareBps?: number;
}

@Injectable()
export class SorobanClientService {
  private readonly logger = new Logger(SorobanClientService.name);
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

  async createGroup(
    params: CreateGroupParams,
  ): Promise<{ address?: string; raw?: any }> {
    const url = `${this.baseUrl}/api/soroban/groups`;
    try {
      const response = await firstValueFrom(
        this.http.post(
          url,
          {
            admin: params.admin,
            amountPerRound: params.amountStroops,
            frequencyDays: params.frequencyDays,
            members: params.members,
            yieldEnabled: params.yieldEnabled ?? true,
            yieldShareBps: params.yieldShareBps ?? 7000,
          },
          { headers: this.buildHeaders() },
        ),
      );
      const data = response.data as any;
      return { address: data?.groupAddress ?? data?.address, raw: data };
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
    const response = await firstValueFrom(
      this.http.post(
        url,
        { winnerAddress: winner },
        { headers: this.buildHeaders() },
      ),
    );
    return { txHash: response.data?.txHash ?? response.data?.tx_hash };
  }

  async sweepYield(groupAddress: string): Promise<{ txHash?: string }> {
    const url = `${this.baseUrl}/api/soroban/groups/${groupAddress}/sweep-yield`;
    const response = await firstValueFrom(
      this.http.post(url, {}, { headers: this.buildHeaders() }),
    );
    return { txHash: response.data?.txHash ?? response.data?.tx_hash };
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
