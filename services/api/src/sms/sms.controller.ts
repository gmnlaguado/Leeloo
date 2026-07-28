import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { SmsService } from './sms.service';

@ApiTags('sms')
@Controller('sms')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @Post('send')
  @ApiOperation({ summary: 'Send an SMS (stub)' })
  async send(@Body() body: { to: string; body: string }) {
    return this.smsService.send(body);
  }
}
