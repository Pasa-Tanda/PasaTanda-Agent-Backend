import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { VerificationWebhookController } from './verification-webhook.controller';
import { SupabaseService } from '../whatsapp/services/supabase.service';

@Module({
  controllers: [OnboardingController, VerificationWebhookController],
  providers: [OnboardingService, SupabaseService],
  exports: [OnboardingService, SupabaseService],
})
export class OnboardingModule {}