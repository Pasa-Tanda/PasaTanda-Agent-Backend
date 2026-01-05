import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Gemini,
  InMemoryRunner,
  LlmAgent,
  isFinalResponse,
  stringifyContent,
} from '@google/adk';
import type { RouterAction, RouterMessageContext } from '../whatsapp.types';
import { GameMasterAgentService } from '../agents/game-master.agent';
import { TreasurerAgentService } from '../agents/treasurer.agent';
import { ValidatorAgentService } from '../agents/validator.agent';

export type PasatandaIntent =
  | 'PAY_QUOTA'
  | 'CHECK_STATUS'
  | 'CREATE_GROUP'
  | 'START_TANDA'
  | 'UPLOAD_PROOF'
  | 'UNKNOWN';

interface ClassificationResult {
  intent: PasatandaIntent;
  entities: Record<string, any>;
  confidence: number;
}

@Injectable()
export class PasatandaOrchestratorService {
  private readonly logger = new Logger(PasatandaOrchestratorService.name);
  private readonly runner: InMemoryRunner;
  private readonly companyId: string;

  constructor(
    private readonly config: ConfigService,
    private readonly gameMaster: GameMasterAgentService,
    private readonly treasurer: TreasurerAgentService,
    private readonly validator: ValidatorAgentService,
  ) {
    this.companyId = this.config.get<string>('COMPANY_ID', 'pasatanda-default');
    const apiKey = this.config.get<string>('GOOGLE_GENAI_API_KEY', '');
    const model = new Gemini({
      apiKey,
      model: 'gemini-1.5-flash',
    });

    const instruction = `Eres el orquestador de PasaTanda.
Debes clasificar el mensaje en uno de estos intents y extraer entidades:
- PAY_QUOTA: usuario quiere pagar cuota.
- CHECK_STATUS: usuario quiere ver estado del grupo o su turno.
- CREATE_GROUP: quiere crear o configurar una tanda.
- START_TANDA: admin confirma inicio de tanda y despliegue de contrato.
- UPLOAD_PROOF: sube comprobante o voucher.

Responde solo JSON con forma {"intent":"...","entities":{...},"confidence":0-1}.
Campos sugeridos en entities: amountUsd, currency, groupId, participants[], payTo, frequencyDays.`;

    const agent = new LlmAgent({
      name: 'pasatanda_orchestrator',
      model,
      instruction,
      globalInstruction: 'Siempre responde en JSON válido, en español.',
    });

    this.runner = new InMemoryRunner({
      agent,
      appName: 'pasatanda-backend',
    });
  }

  async route(
    context: RouterMessageContext,
  ): Promise<{ intent: PasatandaIntent; actions: RouterAction[] }> {
    const phoneNumberId =
      context.phoneNumberId ||
      this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID', '') ||
      this.config.get<string>('PHONE_NUMBER_ID', '');

    const classification = await this.classify(context);

    switch (classification.intent) {
      case 'PAY_QUOTA': {
        const actions = await this.treasurer.handlePaymentRequest({
          sender: context.senderId,
          payload: {
            amountUsd: Number(
              classification.entities.amountUsd ??
                classification.entities.amount ??
                1,
            ),
            payTo:
              classification.entities.payTo ??
              classification.entities.stellarPublicKey ??
              context.senderId,
            details: classification.entities.details,
          },
        });
        return { intent: classification.intent, actions };
      }
      case 'CHECK_STATUS': {
        const actions = await this.gameMaster.handleCheckStatus({
          groupId:
            classification.entities.groupId ??
            classification.entities.group_whatsapp_id,
        });
        return { intent: classification.intent, actions };
      }
      case 'CREATE_GROUP': {
        const actions = await this.gameMaster.handleCreateGroup({
          phoneNumberId,
          sender: context.senderId,
          payload: {
            subject:
              classification.entities.subject ??
              classification.entities.groupName ??
              'PasaTanda',
            participants: classification.entities.participants ?? [],
            amountUsd:
              classification.entities.amountUsd ??
              classification.entities.amount ??
              1,
            frequencyDays: classification.entities.frequencyDays ?? 7,
            yieldEnabled: classification.entities.yieldEnabled ?? true,
          },
        });
        return { intent: classification.intent, actions };
      }
      case 'START_TANDA': {
        const actions = await this.gameMaster.handleStartTanda({
          sender: context.senderId,
          groupId: classification.entities.groupId ?? context.groupId,
          amountUsd: classification.entities.amountUsd,
          amountBs: classification.entities.amountBs,
          frequencyDays: classification.entities.frequencyDays,
          yieldEnabled: classification.entities.yieldEnabled,
        });
        return { intent: classification.intent, actions };
      }
      case 'UPLOAD_PROOF': {
        const actions = await this.validator.handleUploadProof(
          context.whatsappMessageId,
        );
        return { intent: classification.intent, actions };
      }
      default:
        return {
          intent: 'UNKNOWN',
          actions: [
            {
              type: 'text',
              text: 'Puedo ayudarte a crear tu tanda, revisar estado o generar un pago. Indícame qué necesitas.',
            },
          ],
        };
    }
  }

  private async classify(
    context: RouterMessageContext,
  ): Promise<ClassificationResult> {
    const sessionId = `${this.companyId}:${context.senderId}`;
    const prompt = `${context.originalText}`;

    let raw = '';

    for await (const event of this.runner.runAsync({
      userId: context.senderId,
      sessionId,
      newMessage: { role: 'user', parts: [{ text: prompt }] },
    })) {
      if (isFinalResponse(event)) {
        raw = stringifyContent(event);
      }
    }

    try {
      const parsed = JSON.parse(raw) as ClassificationResult;
      return {
        intent: parsed.intent ?? 'UNKNOWN',
        entities: parsed.entities ?? {},
        confidence: parsed.confidence ?? 0,
      };
    } catch (error) {
      this.logger.warn(
        `Fallo parseando respuesta del orquestador: ${(error as Error).message}`,
      );
      return { intent: 'UNKNOWN', entities: {}, confidence: 0 };
    }
  }
}
