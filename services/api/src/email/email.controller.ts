import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
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
  async send(@Body() body: { to: string; subject: string; body?: string; text?: string }) {
    const text = typeof body?.body === 'string' ? body.body : body.text;
    return this.emailService.sendEmail({
      to: body.to,
      subject: body.subject,
      text: String(text || ''),
    });
  }

  @Get('school-scan')
  @ApiOperation({
    summary: 'Scan inbox for school-related emails and create approval tasks (stub)',
  })
  async schoolScan() {
    return {
      ok: true,
      mock: true,
      created_tasks: 0,
      matches: [],
    };
  }
}
