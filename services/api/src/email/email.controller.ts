import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { EmailService } from './email.service';
import { ProfilesService } from '../profiles/profiles.service';

type AuthedRequest = { user?: { id: string } };

@ApiTags('email')
@Controller('email')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class EmailController {
  constructor(
    private readonly emailService: EmailService,
    private readonly profilesService: ProfilesService,
  ) {}

  @Post('send')
  @ApiOperation({ summary: 'Send an email — reply_to set from user profile automatically' })
  async send(
    @Req() req: AuthedRequest,
    @Body() body: { to: string; subject: string; body?: string; text?: string },
  ) {
    const text = typeof body?.body === 'string' ? body.body : body.text;
    let replyTo: string | undefined;

    try {
      const userId = req.user?.id;
      if (userId) {
        const profile = await this.profilesService.getProfileByClerkUserId(userId);
        const rt = profile?.preferences?.user_identity?.reply_to_email;
        if (typeof rt === 'string' && rt.trim()) replyTo = rt.trim();
      }
    } catch {
      // best effort
    }

    return this.emailService.sendEmail({
      to: body.to,
      subject: body.subject,
      text: String(text || ''),
      replyTo,
    });
  }

  @Get('school-scan')
  @ApiOperation({ summary: 'Scan inbox for school-related emails (stub)' })
  async schoolScan() {
    return { ok: true, mock: true, created_tasks: 0, matches: [] };
  }
}
