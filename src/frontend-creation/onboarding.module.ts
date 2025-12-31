import { Module, forwardRef } from '@nestjs/common';
import { SupabaseService } from '../whatsapp/services/supabase.service';
import { GroupCreationController } from './group-creation.controller';
import { GroupCreationService } from './group-creation.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [forwardRef(() => WhatsappModule)],
  controllers: [GroupCreationController],
  providers: [GroupCreationService, SupabaseService],
  exports: [GroupCreationService, SupabaseService],
})
export class OnboardingModule {}
