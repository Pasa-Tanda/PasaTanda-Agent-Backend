import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import FormData from 'form-data';

interface PinataUploadResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

@Injectable()
export class PinataService {
  private readonly logger = new Logger(PinataService.name);
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly jwt: string;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.apiKey = this.config.get<string>('PINATA_API_KEY', '');
    this.apiSecret = this.config.get<string>('PINATA_API_SECRET', '');
    this.jwt = this.config.get<string>('PINATA_JWT', '');
    this.enabled = !!(this.jwt || (this.apiKey && this.apiSecret));

    if (!this.enabled) {
      this.logger.warn('Pinata no configurado. Las imágenes no se subirán a IPFS.');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Sube una imagen a Pinata IPFS desde base64
   * @param base64Data Datos de imagen en base64 (sin el prefijo data:image/...)
   * @param filename Nombre del archivo
   * @returns URL pública de la imagen en IPFS
   */
  async uploadImageFromBase64(
    base64Data: string,
    filename: string = `image-${Date.now()}.png`,
  ): Promise<string | null> {
    if (!this.enabled) {
      this.logger.warn('Pinata no está habilitado');
      return null;
    }

    try {
      // Convertir base64 a buffer
      const buffer = Buffer.from(base64Data, 'base64');

      // Crear FormData
      const formData = new FormData();
      formData.append('file', buffer, {
        filename,
        contentType: 'image/png',
      });

      // Metadatos opcionales
      const metadata = JSON.stringify({
        name: filename,
        keyvalues: {
          type: 'qr-payment',
          timestamp: Date.now().toString(),
        },
      });
      formData.append('pinataMetadata', metadata);

      // Configurar headers
      const headers = {
        ...formData.getHeaders(),
      };

      // Usar JWT si está disponible, sino API key + secret
      if (this.jwt) {
        headers['Authorization'] = `Bearer ${this.jwt}`;
      } else {
        headers['pinata_api_key'] = this.apiKey;
        headers['pinata_secret_api_key'] = this.apiSecret;
      }

      // Subir a Pinata
      const response = await firstValueFrom(
        this.httpService.post<PinataUploadResponse>(
          'https://api.pinata.cloud/pinning/pinFileToIPFS',
          formData,
          { headers },
        ),
      );

      const ipfsHash = response.data.IpfsHash;
      const publicUrl = `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;

      this.logger.log(`Imagen subida a Pinata: ${publicUrl}`);
      return publicUrl;
    } catch (error) {
      const err = error as Error & { response?: { data?: unknown } };
      const details = err.response?.data ?? err.message;
      this.logger.error('Error subiendo imagen a Pinata:', details);
      return null;
    }
  }

  /**
   * Obtiene la URL pública de un hash IPFS
   */
  getPublicUrl(ipfsHash: string): string {
    return `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;
  }
}
