import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { PaymentWebhookController } from './payment-webhook.controller';
import { EncryptionService } from './services/encryption.service';
import { PinataService } from './services/pinata.service';
import { PaymentProxyController } from './payment-proxy.controller';
import { PaymentOrdersController } from './payment-orders.controller';
import { GameMasterAgentService } from './agents/game-master.agent';
import { TreasurerAgentService } from './agents/treasurer.agent';
import { ValidatorAgentService } from './agents/validator.agent';
import { PaymentIntegrationService } from './services/payment-integration.service';
import { SorobanClientService } from './services/soroban-client.service';
import { VerificationService } from './services/verification.service';
import { FrontendWebhookService } from './services/frontend-webhook.service';
import { OnboardingModule } from '../frontend-creation/onboarding.module';
// ADK Services
import { SupabaseSessionService } from './services/supabase-session.service';
import { PasatandaToolsService } from './agents/pasatanda-tools.service';
import {
  AdkGameMasterAgent,
  AdkTreasurerAgent,
  AdkValidatorAgent,
} from './agents/adk-subagents';
import { AdkOrchestratorService } from './agents/adk-orchestrator.service';
import { WhatsAppMessagingService } from './services/whatsapp-messaging.service';
import { SupabaseService } from './services/supabase.service';
import { GeminiService } from './services/gemini.service';
import { PaymentCycleSchedulerService } from './services/payment-cycle-scheduler.service';

@Module({
  imports: [HttpModule, ConfigModule, forwardRef(() => OnboardingModule)],
  controllers: [
    WhatsappController,
    PaymentWebhookController,
    PaymentProxyController,
    PaymentOrdersController,
  ],
  providers: [
    // Core services
    WhatsappService,
    EncryptionService,
    PinataService,
    SupabaseService,
    GeminiService,

    // Agentes activos
    GameMasterAgentService,
    TreasurerAgentService,
    ValidatorAgentService,

    // ADK services
    SupabaseSessionService,
    PasatandaToolsService,
    AdkGameMasterAgent,
    AdkTreasurerAgent,
    AdkValidatorAgent,
    AdkOrchestratorService,

    // WhatsApp messaging
    WhatsAppMessagingService,

    // Business services
    PaymentIntegrationService,
    SorobanClientService,
    VerificationService,
    FrontendWebhookService,

    // Schedulers
    PaymentCycleSchedulerService,
  ],
  exports: [WhatsappService, WhatsAppMessagingService, AdkOrchestratorService],
})
export class WhatsappModule {}
