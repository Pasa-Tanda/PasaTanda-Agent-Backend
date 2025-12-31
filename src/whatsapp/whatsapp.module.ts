import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { PaymentWebhookController } from './payment-webhook.controller';
import { EncryptionService } from './services/encryption.service';
import { PinataService } from './services/pinata.service';
import { PaymentProxyController } from './payment-proxy.controller';
import { PaymentOrdersController } from './payment-orders.controller';
import { PasatandaOrchestratorService } from './services/pasatanda-orchestrator.service';
import { GameMasterAgentService } from './agents/game-master.agent';
import { TreasurerAgentService } from './agents/treasurer.agent';
import { ValidatorAgentService } from './agents/validator.agent';
import { PaymentIntegrationService } from './services/payment-integration.service';
import { SorobanClientService } from './services/soroban-client.service';
import { GroupService } from './services/group.service';
import { VerificationService } from './services/verification.service';
import { FrontendWebhookService } from './services/frontend-webhook.service';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
  imports: [HttpModule, ConfigModule, OnboardingModule],
  controllers: [
    WhatsappController,
    PaymentWebhookController,
    PaymentProxyController,
    PaymentOrdersController,
  ],
  providers: [
    WhatsappService,
    EncryptionService,
    PinataService,
    PasatandaOrchestratorService,
    GameMasterAgentService,
    TreasurerAgentService,
    ValidatorAgentService,
    PaymentIntegrationService,
    SorobanClientService,
    GroupService,
    VerificationService,
    FrontendWebhookService,
  ],
  exports: [WhatsappService],
})
export class WhatsappModule {}
