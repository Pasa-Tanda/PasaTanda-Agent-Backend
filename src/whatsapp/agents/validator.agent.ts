import { Injectable, Logger } from '@nestjs/common';
import type { RouterAction } from '../whatsapp.types';

@Injectable()
export class ValidatorAgentService {
  private readonly logger = new Logger(ValidatorAgentService.name);

  async handleUploadProof(messageId: string): Promise<RouterAction[]> {
    this.logger.log(`Solicitud de comprobante para mensaje ${messageId}`);
    return [
      {
        type: 'text',
        text: 'Envía una foto legible del comprobante. Detectaré monto, banco y referencia para verificarlo.',
      },
    ];
  }
}
