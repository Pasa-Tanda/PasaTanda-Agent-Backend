import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

interface GroupCreatePayload {
  subject: string;
  participants: string[];
}

interface ParticipantsPayload {
  participants: string[];
}

interface AdminsPayload {
  admins: string[];
}

@Injectable()
export class GroupService {
  private readonly logger = new Logger(GroupService.name);
  private readonly apiVersion: string;
  private readonly apiToken: string;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.apiVersion = config.get<string>('WHATSAPP_API_VERSION', 'v21.0');
    this.apiToken = config.get<string>('META_API_TOKEN', '');
  }

  async createGroup(phoneNumberId: string, payload: GroupCreatePayload): Promise<{ id?: string }> {
    const url = this.buildUrl(`${phoneNumberId}/groups`);
    const response = await this.call('post', url, payload);
    return { id: response?.id ?? response?.group_id };
  }

  async addParticipants(phoneNumberId: string, groupId: string, participants: string[]): Promise<void> {
    const url = this.buildUrl(`${groupId}/participants`);
    await this.call('post', url, { participants } as ParticipantsPayload);
  }

  async removeParticipants(phoneNumberId: string, groupId: string, participants: string[]): Promise<void> {
    const url = this.buildUrl(`${groupId}/participants`);
    await this.call('delete', url, { participants } as ParticipantsPayload);
  }

  async updateSubject(groupId: string, subject: string): Promise<void> {
    const url = this.buildUrl(`${groupId}`);
    await this.call('post', url, { subject });
  }

  async updateDescription(groupId: string, description: string): Promise<void> {
    const url = this.buildUrl(`${groupId}`);
    await this.call('post', url, { description });
  }

  async setAdmins(groupId: string, admins: string[]): Promise<void> {
    const url = this.buildUrl(`${groupId}/admins`);
    await this.call('post', url, { admins } as AdminsPayload);
  }

  private buildUrl(path: string): string {
    return `https://graph.facebook.com/${this.apiVersion}/${path}`;
  }

  private async call(method: 'post' | 'get' | 'delete', url: string, data?: Record<string, any>): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.http.request({
          method,
          url,
          data,
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
        }),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`WhatsApp Groups API fallo ${method.toUpperCase()} ${url}: ${(error as Error).message}`);
      throw error;
    }
  }
}
