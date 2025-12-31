import { Module } from '@nestjs/common';
import { SupabaseService } from '../whatsapp/services/supabase.service';
import { GroupCreationController } from './group-creation.controller';
import { GroupCreationService } from './group-creation.service';

@Module({
  controllers: [GroupCreationController],
  providers: [GroupCreationService, SupabaseService],
  exports: [GroupCreationService, SupabaseService],
})
export class OnboardingModule {}
