import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';

@Controller('api/webhook')
export class VerificationWebhookController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('confirm_verification')
  async pollVerification(@Query('phone') phone?: string) {
    if (!phone) {
      throw new BadRequestException({
        success: false,
        message: 'Missing required field: phone',
      });
    }

    return this.onboarding.getVerificationStatus(phone);
  }

  @Post('confirm_verification')
  async confirmVerification(
    @Body()
    body: {
      phone?: string;
      verified?: boolean;
      timestamp?: number;
      whatsappUsername?: string;
      whatsappNumber?: string;
    },
  ) {
    if (!body.phone || typeof body.verified !== 'boolean') {
      throw new BadRequestException({
        success: false,
        message: 'Missing required fields: phone and verified',
      });
    }

    const record = await this.onboarding.confirmVerification({
      phone: body.phone,
      verified: body.verified,
      timestamp: body.timestamp,
      whatsappUsername: body.whatsappUsername,
      whatsappNumber: body.whatsappNumber,
    });

    return {
      success: true,
      verified: record.verified,
      timestamp: record.timestamp,
      whatsappUsername: record.whatsappUsername,
      whatsappNumber: record.whatsappNumber,
      message: 'Phone verification confirmed successfully',
    };
  }
}