import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { EmailService } from './email.service';

@ApiTags('email')
@Controller('email')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post('send')
  @ApiOperation({ summary: 'Send an email (provider-backed)' })
  async send(@Body() body: { to: string; subject: string; text: string }) {
    return this.emailService.sendEmail(body);
  }
}
