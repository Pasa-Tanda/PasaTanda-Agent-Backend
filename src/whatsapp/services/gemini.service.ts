import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Gemini } from '@google/adk';

@Injectable()
export class GeminiService implements OnModuleInit {
  private readonly logger = new Logger(GeminiService.name);
  private geminiModel: Gemini | null = null;
  private readonly configuredModelName: string;

  constructor(private readonly config: ConfigService) {
    const rawModel = this.config.get<string>('GOOGLE_GENAI_MODEL') ?? '';
    this.configuredModelName = rawModel.trim() || 'gemini-2.5-flash-lite';
  }

  onModuleInit() {
    const apiKey = this.config.get<string>('GOOGLE_GENAI_API_KEY');
    const useVertexAi =
      this.config.get<string>('GOOGLE_GENAI_USE_VERTEXAI') === 'true';
    const modelName = this.configuredModelName;

    if (!apiKey && !useVertexAi) {
      this.logger.warn(
        'GOOGLE_GENAI_API_KEY no configurado y GOOGLE_GENAI_USE_VERTEXAI no está activo. ' +
          'El sistema funcionará con lógica estática de fallback.',
      );
      return;
    }

    try {
      if (useVertexAi) {
        const project = this.config.get<string>('GOOGLE_CLOUD_PROJECT');
        const location = this.config.get<string>(
          'GOOGLE_CLOUD_LOCATION',
          'us-central1',
        );

        if (!project) {
          throw new Error('GOOGLE_CLOUD_PROJECT es requerido para Vertex AI');
        }

        this.geminiModel = new Gemini({
          model: modelName,
          vertexai: true,
          project,
          location,
        });

        this.logger.log(
          `Gemini inicializado con Vertex AI (modelo: ${modelName}, proyecto: ${project}, ubicación: ${location})`,
        );
      } else {
        this.geminiModel = new Gemini({
          model: modelName,
          apiKey,
        });

        this.logger.log(
          `Gemini inicializado con API Key (modelo: ${modelName})`,
        );
      }
    } catch (error) {
      this.logger.error('Error al inicializar Gemini:', error);
      this.geminiModel = null;
    }
  }

  /**
   * Retorna la instancia del modelo Gemini configurado.
   * Null si no hay credenciales o hubo error en inicialización.
   */
  getModel(): Gemini | null {
    return this.geminiModel;
  }

  /**
   * Indica si el servicio está habilitado y listo para usar.
   */
  isEnabled(): boolean {
    return this.geminiModel !== null;
  }

  /**
   * Genera contenido de texto usando Gemini.
   * Wrapper simplificado para llamadas directas al modelo.
   */
  async generateText(prompt: string): Promise<string | null> {
    if (!this.geminiModel) {
      return null;
    }

    try {
      const request = {
        contents: [
          {
            role: 'user' as const,
            parts: [{ text: prompt }],
          },
        ],
        toolsDict: {},
        liveConnectConfig: {},
      };

      let responseText = '';
      for await (const response of this.geminiModel.generateContentAsync(
        request,
        false,
      )) {
        const text = response.content?.parts?.map((p) => p.text).join('') || '';
        responseText += text;
      }

      return responseText.trim() || null;
    } catch (error) {
      this.logger.error('Error generando texto con Gemini:', error);
      return null;
    }
  }

  /**
   * Genera respuesta de chat considerando historial.
   */
  async generateChatResponse(
    history: { role: 'user' | 'model'; text: string }[],
    prompt: string,
  ): Promise<string | null> {
    if (!this.geminiModel) {
      return null;
    }

    try {
      const contents = history.map((msg) => ({
        role: msg.role,
        parts: [{ text: msg.text }],
      }));

      contents.push({
        role: 'user' as const,
        parts: [{ text: prompt }],
      });

      const request = {
        contents,
        toolsDict: {},
        liveConnectConfig: {},
      };

      let responseText = '';
      for await (const response of this.geminiModel.generateContentAsync(
        request,
        false,
      )) {
        const text = response.content?.parts?.map((p) => p.text).join('') || '';
        responseText += text;
      }

      return responseText.trim() || null;
    } catch (error) {
      this.logger.error('Error generando chat con Gemini:', error);
      return null;
    }
  }
}
