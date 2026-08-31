import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { EmailService } from './email.service';
import { ProfilesService } from '../profiles/profiles.service';
import { IntegrationsService } from '../integrations/integrations.service';
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
    private readonly tasksService: TasksService,
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
    } catch { /* best effort */ }
    return this.emailService.sendEmail({ to: body.to, subject: body.subject, text: String(text || ''), replyTo });
  }

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
      // Search Gmail for recent school-related emails (last 30 days)
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
          const msgRes = await axios.get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
            params: { format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] },
            timeout: 8_000,
          });
          const headers: any[] = msgRes.data?.payload?.headers ?? [];
          const getH = (name: string) => headers.find((h: any) => h.name === name)?.value ?? '';
          const subject = getH('Subject');
          const from    = getH('From');
          const date    = getH('Date');

          const lowerSubject = subject.toLowerCase();
          const isSchool = SCHOOL_KEYWORDS.some((k) => lowerSubject.includes(k));
          if (!isSchool) continue;

          matches.push({ subject, from, date });

          // Create a task so the parent doesn't miss it
          try {
            await this.tasksService.createTask({
              user_id: userId,
              title: `📚 ${subject.slice(0, 80)}`,
              description: `De: ${from}`,
              metadata: { source: 'school_email', gmail_id: id, from, date },
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
