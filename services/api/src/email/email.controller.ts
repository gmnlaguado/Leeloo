import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { EmailService } from './email.service';
import { ProfilesService } from '../profiles/profiles.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { GoogleGmailService } from '../integrations/google-gmail.service';
import { TasksService } from '../tasks/tasks.service';
import axios from 'axios';

type AuthedRequest = { user?: { id: string } };

const SCHOOL_KEYWORDS = [
  'tarea', 'homework', 'asignación', 'assignment', 'examen', 'exam', 'test',
  'calificación', 'grade', 'reunión de padres', 'parent meeting', 'teacher',
  'maestro', 'maestra', 'profesor', 'profesora', 'colegio', 'escuela', 'school',
  'nota', 'report card', 'boletín', 'materia', 'subject', 'clase', 'class',
  'proyecto', 'project', 'entrega', 'due date', 'fecha límite',
];

@ApiTags('email')
@Controller('email')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class EmailController {
  constructor(
    private readonly emailService: EmailService,
    private readonly profilesService: ProfilesService,
    private readonly integrationsService: IntegrationsService,
    private readonly googleGmailService: GoogleGmailService,
    private readonly tasksService: TasksService,
  ) {}

  // ── Send via SMTP (no Google auth required) ────────────────────────────────
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
    } catch { /* best effort */ }
    return this.emailService.sendEmail({ to: body.to, subject: body.subject, text: String(text || ''), replyTo });
  }

  // ── Send via Gmail OAuth (from user's actual Gmail account) ───────────────
  @Post('gmail/send')
  @ApiOperation({ summary: 'Send email via user\'s connected Gmail account' })
  async sendViaGmail(
    @Req() req: AuthedRequest,
    @Body() body: { to: string; subject: string; body: string; threadId?: string },
  ) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, error: 'Unauthenticated' };

    let token: string;
    try {
      const result = await this.integrationsService.getValidAccessToken(userId, 'google');
      token = result.token;
    } catch {
      return { ok: false, error: 'google_not_connected', message: 'Connect your Google account first in Settings → Integrations.' };
    }

    return this.googleGmailService.sendGmailMessage(token, {
      to: body.to,
      subject: body.subject,
      body: body.body,
      threadId: body.threadId,
    });
  }

  // ── List inbox ─────────────────────────────────────────────────────────────
  @Get('inbox')
  @ApiOperation({ summary: 'List Gmail inbox messages' })
  async listInbox(
    @Req() req: AuthedRequest,
    @Query('maxResults') maxResults?: string,
    @Query('q') q?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, error: 'Unauthenticated' };

    let token: string;
    try {
      const result = await this.integrationsService.getValidAccessToken(userId, 'google');
      token = result.token;
    } catch {
      return { ok: false, error: 'google_not_connected', messages: [] };
    }

    return this.googleGmailService.listInbox(token, {
      maxResults: maxResults ? Math.min(Number(maxResults) || 10, 20) : 10,
      q: q || undefined,
      unreadOnly: unreadOnly === 'true',
    });
  }

  // ── Get single email (full body) ───────────────────────────────────────────
  @Get('inbox/:id')
  @ApiOperation({ summary: 'Get a single Gmail message with full body' })
  async getMessage(@Req() req: AuthedRequest, @Param('id') id: string) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, error: 'Unauthenticated' };

    let token: string;
    try {
      const result = await this.integrationsService.getValidAccessToken(userId, 'google');
      token = result.token;
    } catch {
      return { ok: false, error: 'google_not_connected' };
    }

    const result = await this.googleGmailService.getMessageFull(token, id);
    if (result.ok && result.message?.isUnread) {
      void this.googleGmailService.markAsRead(token, id).catch(() => {});
    }
    return result;
  }

  // ── School email scan ──────────────────────────────────────────────────────
  @Get('school-scan')
  @ApiOperation({ summary: 'Scan Gmail inbox for school-related emails and create tasks' })
  async schoolScan(@Req() req: AuthedRequest) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, error: 'Unauthenticated' };

    let token: string;
    try {
      const result = await this.integrationsService.getValidAccessToken(userId, 'google');
      token = result.token;
    } catch {
      return { ok: false, error: 'Google not connected. Please connect your Google account in Integrations.', matches: [] };
    }

    try {
      const query = 'newer_than:30d (' + SCHOOL_KEYWORDS.slice(0, 8).map(k => `subject:${k}`).join(' OR ') + ')';
      const listRes = await axios.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
        headers: { Authorization: `Bearer ${token}` },
        params: { q: query, maxResults: 20 },
        timeout: 10_000,
      });

      const messages: any[] = listRes.data?.messages ?? [];
      if (!messages.length) {
        return { ok: true, matches: [], created_tasks: 0, message: 'No school-related emails found in the last 30 days.' };
      }

      const matches: any[] = [];
      let created_tasks = 0;

      for (const { id } of messages.slice(0, 10)) {
        try {
          const meta = await this.googleGmailService.getMessageMetadata(token, id);
          if (!meta) continue;
          const lowerSubject = meta.subject.toLowerCase();
          const isSchool = SCHOOL_KEYWORDS.some((k) => lowerSubject.includes(k));
          if (!isSchool) continue;
          matches.push({ subject: meta.subject, from: meta.from, date: meta.date });
          try {
            await this.tasksService.createTask({
              user_id: userId,
              title: `📚 ${meta.subject.slice(0, 80)}`,
              description: `De: ${meta.from}`,
              metadata: { source: 'school_email', gmail_id: id, from: meta.from, date: meta.date },
            });
            created_tasks++;
          } catch { /* task creation non-fatal */ }
        } catch { /* skip unreadable message */ }
      }

      return { ok: true, matches, created_tasks };
    } catch (err: any) {
      return { ok: false, error: `Gmail scan failed: ${String(err?.message)}`, matches: [] };
    }
  }
}
