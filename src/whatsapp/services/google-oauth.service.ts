import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

interface GoogleTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string;
  token_type?: string | null;
  id_token?: string | null;
}

@Injectable()
export class GoogleOauthService {
  private readonly logger = new Logger(GoogleOauthService.name);
  private readonly oauthClient?: OAuth2Client;
  private readonly scopes: string[];

  constructor(private readonly configService: ConfigService) {
    const clientId = this.configService.get<string>('GOOGLE_OAUTH_CLIENT_ID');
    const clientSecret = this.configService.get<string>(
      'GOOGLE_OAUTH_CLIENT_SECRET',
    );
    const redirectUri = this.configService.get<string>(
      'GOOGLE_OAUTH_REDIRECT_URI',
    );

    if (clientId && clientSecret && redirectUri) {
      this.oauthClient = new OAuth2Client({
        clientId,
        clientSecret,
        redirectUri,
      });
    } else {
      this.logger.warn(
        'Faltan credenciales de Google OAuth; no se generarán enlaces de consentimiento.',
      );
    }

    const scopeEnv = this.configService.get<string>('GOOGLE_OAUTH_SCOPES');
    this.scopes = scopeEnv
      ? scopeEnv.split(',').map((scope) => scope.trim())
      : [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.events',
        ];
  }

  isEnabled(): boolean {
    return Boolean(this.oauthClient);
  }

  buildConsentUrl(state: Record<string, string>): string | null {
    if (!this.oauthClient) {
      return null;
    }

    const encodedState = Buffer.from(JSON.stringify(state), 'utf8').toString(
      'base64url',
    );

    return this.oauthClient.generateAuthUrl({
      scope: this.scopes,
      access_type: 'offline',
      prompt: 'consent',
      state: encodedState,
    });
  }

  async exchangeCode(code: string): Promise<GoogleTokens | null> {
    if (!this.oauthClient) {
      return null;
    }

    const { tokens } = await this.oauthClient.getToken(code);
    return {
      access_token: tokens.access_token ?? null,
      refresh_token: tokens.refresh_token ?? null,
      expiry_date: tokens.expiry_date ?? null,
      scope: tokens.scope,
      token_type: tokens.token_type ?? null,
      id_token: tokens.id_token ?? null,
    } satisfies GoogleTokens;
  }
}
