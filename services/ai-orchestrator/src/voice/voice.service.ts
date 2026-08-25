import { Injectable } from '@nestjs/common';
import axios from 'axios';
import {
  LEELOO_SYSTEM_PROMPT,
  LEELOO_SYSTEM_PROMPT_VERSION,
  buildSystemPrompt,
  type LeelooPersonality,
} from '@leeloo/ai-prompts';
import { OpenAiQueue } from './workers/openai.queue';
import { TtsFactory } from '../tts/tts.factory';

type SupportedLanguage = 'es' | 'en' | 'pt' | 'fr' | 'ja';

type IntentResult = {
  intent: string;
  confidence: number;
  language: SupportedLanguage;
  slots: Record<string, string | undefined>;
  assistant_text: string;
  needs_confirmation?: boolean;
};

@Injectable()
export class VoiceService {
  constructor(
    private readonly openAiQueue: OpenAiQueue,
    private readonly ttsFactory: TtsFactory,
  ) {}

  async processVoice(input: {
    userId: string;
    language?: string;
    wakeWordOnly: boolean;
    text?: string;
    audio?: Express.Multer.File;
    authorization?: string;
    confirmation?: 'confirmed' | 'cancel';
    personality?: string;
    userName?: string;
    pending_event_id?: string;
    pending_attendee_name?: string;
  }) {
    const language = this.normalizeLanguage(input.language);

    let transcription = '';
    try {
      transcription = input.text
        ? String(input.text)
        : await this.openAiQueue.transcribe({
            userId: input.userId,
            filename: input.audio?.originalname || 'audio.webm',
            bytes: input.audio?.buffer || Buffer.from(''),
          });
    } catch (err: any) {
      return {
        ok: false,
        transcription: input.text ? String(input.text) : '',
        intent: {
          intent: 'chat',
          confidence: 0.1,
          language,
          slots: {},
          assistant_text: this.fallbackText(language, err),
        },
        action: null,
        assistant_text: this.fallbackText(language, err),
        tts: null,
      };
    }

    if (input.wakeWordOnly) {
      return {
        ok: true,
        mode: 'wake_word_only',
        transcription,
      };
    }

    let memories = '';
    try {
      memories = await this.openAiQueue.fetchMemoryContext({
        userId: input.userId,
        query: transcription,
        limit: 5,
      });
    } catch {
      memories = '';
    }

    const validPersonalities: LeelooPersonality[] = [
      'default', 'christian', 'coach', 'mentor', 'business', 'counselor', 'faith',
    ];
    const personality: LeelooPersonality =
      validPersonalities.includes(input.personality as LeelooPersonality)
        ? (input.personality as LeelooPersonality)
        : 'default';

    const hour = new Date().getHours();
    const timeOfDay =
      hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : hour < 21 ? 'evening' : 'night';

    const userCtx = input.userName
      ? await this.openAiQueue
          .fetchUserContext(input.userId)
          .catch(() => ({ todayTasks: [], upcomingEvents: [], pendingApprovals: 0 }))
      : { todayTasks: [], upcomingEvents: [], pendingApprovals: 0 };

    const systemPrompt = input.userName
      ? buildSystemPrompt(personality, input.userName, { ...userCtx, timeOfDay })
      : LEELOO_SYSTEM_PROMPT;

    let intent: IntentResult;
    try {
      intent = await this.openAiQueue.extractIntent({
        userId: input.userId,
        language,
        transcription,
        memoryContext: memories,
        systemPrompt,
        systemPromptVersion: LEELOO_SYSTEM_PROMPT_VERSION,
      });
    } catch (err: any) {
      intent = {
        intent: 'chat',
        confidence: 0.1,
        language,
        slots: {},
        assistant_text: this.fallbackText(language, err),
      };
    }

    const actionResult = await this.dispatchAction({
      intent,
      userId: input.userId,
      authorization: input.authorization,
      confirmation: input.confirmation,
      pendingEventId: input.pending_event_id,
      pendingAttendeeName: input.pending_attendee_name,
      language,
    });

    let assistantText = this.buildAssistantText(intent, actionResult);

    // Personality-aware agenda brief — override static text with real formatted data
    if (intent.intent === 'agenda_today' && actionResult?._agendaData) {
      assistantText = this.formatAgendaForVoice(
        actionResult._agendaData,
        personality,
        language,
        input.userName || '',
      );
    }

    const needsConfirmation = Boolean(intent?.needs_confirmation);
    if (needsConfirmation && !input.confirmation) {
      const ttsAudioBase64 = await this.safeTts({
        userId: input.userId,
        text: assistantText,
      });

      return {
        ok: true,
        status: 'awaiting_confirmation',
        transcription,
        intent,
        action: actionResult,
        assistant_text: assistantText,
        tts: ttsAudioBase64
          ? {
              model: 'tts-1-hd',
              voice: 'nova',
              audio_base64: ttsAudioBase64,
            }
          : null,
      };
    }

    if (needsConfirmation && input.confirmation === 'cancel') {
      const cancelText = language === 'es' ? 'Listo, cancelado.' : 'Okay, canceled.';
      const ttsAudioBase64 = await this.safeTts({ userId: input.userId, text: cancelText });
      return {
        ok: true,
        status: 'canceled',
        transcription,
        intent,
        action: { ok: true, canceled: true },
        assistant_text: cancelText,
        tts: ttsAudioBase64
          ? {
              model: 'tts-1-hd',
              voice: 'nova',
              audio_base64: ttsAudioBase64,
            }
          : null,
      };
    }

    if (needsConfirmation && input.confirmation === 'confirmed') {
      const confirmedAction = await this.dispatchAction({
        intent,
        userId: input.userId,
        authorization: input.authorization,
        confirmation: 'confirmed',
        pendingEventId: input.pending_event_id,
        pendingAttendeeName: input.pending_attendee_name,
        language,
      });
      const confirmedText = this.buildAssistantText(intent, confirmedAction);
      const ttsAudioBase64 = await this.safeTts({ userId: input.userId, text: confirmedText });
      this.saveTurnFireAndForget({
        authorization: input.authorization,
        transcription,
        assistantText: confirmedText,
        language,
      });
      return {
        ok: true,
        status: 'executed',
        transcription,
        intent,
        action: confirmedAction,
        assistant_text: confirmedText,
        tts: ttsAudioBase64
          ? {
              model: 'tts-1-hd',
              voice: 'nova',
              audio_base64: ttsAudioBase64,
            }
          : null,
      };
    }

    // After creating an event, ask if the user wants to invite someone.
    if (actionResult?.status === 'awaiting_attendees' && actionResult?.event_id) {
      const askText =
        language === 'es'
          ? `${assistantText} ¿Quieres invitar a alguien?`
          : `${assistantText} Would you like to invite someone?`;
      const ttsAudioBase64 = await this.safeTts({ userId: input.userId, text: askText });
      return {
        ok: true,
        status: 'awaiting_attendees',
        event_id: actionResult.event_id,
        transcription,
        intent,
        action: actionResult,
        assistant_text: askText,
        tts: ttsAudioBase64 ? { model: 'tts-1-hd', voice: 'nova', audio_base64: ttsAudioBase64 } : null,
      };
    }

    // If waiting for an attendee email, return the unresolved state.
    if (actionResult?.status === 'awaiting_attendee_email' && actionResult?.event_id) {
      const askText = actionResult.fallback_text || assistantText;
      const ttsAudioBase64 = await this.safeTts({ userId: input.userId, text: askText });
      return {
        ok: true,
        status: 'awaiting_attendee_email',
        event_id: actionResult.event_id,
        resolved: actionResult.resolved || [],
        unresolved: actionResult.unresolved || [],
        pending_attendee_name: (actionResult.unresolved || [])[0] || '',
        transcription,
        intent,
        action: actionResult,
        assistant_text: askText,
        tts: ttsAudioBase64 ? { model: 'tts-1-hd', voice: 'nova', audio_base64: ttsAudioBase64 } : null,
      };
    }

    const ttsAudioBase64 = await this.safeTts({
      userId: input.userId,
      text: assistantText,
    });

    // Persist this exchange so Leeloo remembers it in future sessions
    this.saveTurnFireAndForget({
      authorization: input.authorization,
      transcription,
      assistantText,
      language,
    });

    return {
      ok: true,
      status: 'ok',
      transcription,
      intent,
      action: actionResult,
      assistant_text: assistantText,
      tts: ttsAudioBase64
        ? {
            model: 'tts-1-hd',
            voice: 'nova',
            audio_base64: ttsAudioBase64,
          }
        : null,
    };
  }

  private formatAgendaForVoice(
    data: any,
    personality: string,
    language: string,
    userName: string,
  ): string {
    const name = (userName || 'amiga').split(' ')[0];
    const isEs = String(language || 'es').startsWith('es');

    const events: any[] = Array.isArray(data?.events) ? data.events : [];
    const tasks: any[] = Array.isArray(data?.tasks) ? data.tasks : [];
    const now = data?.now ? new Date(data.now) : new Date();

    const formatTime = (iso: string) => {
      try {
        return new Date(iso).toLocaleTimeString(isEs ? 'es-CO' : 'en-US', {
          hour: '2-digit', minute: '2-digit', hour12: true,
        });
      } catch { return ''; }
    };

    // Build event lines (upcoming only, max 3)
    const upcomingEvents = events
      .filter((e) => e.start_at && new Date(e.start_at).getTime() >= now.getTime() - 30 * 60 * 1000)
      .slice(0, 3)
      .map((e) => `${e.title}${e.start_at ? ` a las ${formatTime(e.start_at)}` : ''}${e.location ? ` en ${e.location}` : ''}`);

    // Build task lines (pending only, max 3)
    const pendingTasks = tasks
      .filter((t) => t.status === 'pending' || t.status === 'in_progress')
      .slice(0, 3)
      .map((t) => t.title);

    const totalEvents = events.length;
    const totalTasks = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress').length;
    const hasNothing = totalEvents === 0 && totalTasks === 0;

    if (hasNothing) {
      const empty: Record<string, string> = {
        christian: `¡Buenos días, ${name}! Tienes el día libre. Usa este tiempo para descansar y recargar energía. Dios tiene algo especial para ti hoy.`,
        coach: `¡${name}, tienes el calendario libre! Es el momento perfecto para trabajar en ese proyecto que has estado postergando. ¿Cuál es tu próximo paso más importante?`,
        business: `${name}, sin reuniones programadas hoy. Día ideal para estrategia y trabajo profundo. ¿Qué iniciativa avanzas?`,
        counselor: `${name}, hoy tienes el día abierto. Eso es un regalo. ¿Cómo quieres usarlo para ti misma?`,
        mentor: `${name}, sin compromisos externos hoy. Los días libres son para construir lo que importa. ¿Qué meta avanzas?`,
        faith: `${name}, el día está abierto. Cada hora es un regalo. ¿Qué harás con ella?`,
        default: `Hola ${name}, hoy tienes el calendario libre. ¡El día es tuyo!`,
      };
      return empty[personality] ?? empty.default;
    }

    const listLine = [
      ...(upcomingEvents.length ? (isEs ? [`Eventos: ${upcomingEvents.join(', ')}`] : [`Events: ${upcomingEvents.join(', ')}`]) : []),
      ...(pendingTasks.length ? (isEs ? [`Tareas: ${pendingTasks.join(', ')}`] : [`Tasks: ${pendingTasks.join(', ')}`]) : []),
    ].join('. ');

    const summaryEs = `${totalEvents > 0 ? `${totalEvents} evento${totalEvents > 1 ? 's' : ''}` : ''}${totalEvents > 0 && totalTasks > 0 ? ' y ' : ''}${totalTasks > 0 ? `${totalTasks} tarea${totalTasks > 1 ? 's' : ''}` : ''}`;

    const prefixes: Record<string, string> = {
      christian: `Buenos días, ${name}. Hoy tienes ${summaryEs}. Que Dios guíe cada uno. `,
      coach: `¡Vamos ${name}! Son ${summaryEs} para hoy. Foco total. `,
      business: `${name}, briefing de hoy: ${summaryEs}. `,
      counselor: `${name}, veamos tu día juntas. Tienes ${summaryEs}. `,
      mentor: `${name}, hoy son ${summaryEs}. Que cada uno te acerque a tus metas. `,
      faith: `${name}, hoy tienes ${summaryEs}. Cada compromiso es un propósito. `,
      default: `Hola ${name}, para hoy tienes ${summaryEs}. `,
    };

    const suffix: Record<string, string> = {
      coach: ' ¿Por cuál arrancamos?',
      business: ' ¿Quieres que prepare algo para la primera reunión?',
      counselor: ' ¿Cómo te sientes al verlos?',
      default: '',
    };

    const prefix = prefixes[personality] ?? prefixes.default;
    const end = suffix[personality] ?? suffix.default;
    return `${prefix}${listLine}.${end}`;
  }

  private saveTurnFireAndForget(opts: {
    authorization: string | undefined;
    transcription: string;
    assistantText: string;
    language: string;
  }) {
    const apiBaseUrl = String(process.env.API_BASE_URL || process.env.API_URL || '').trim();
    if (!apiBaseUrl || !opts.transcription || !opts.assistantText) return;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.authorization) headers['Authorization'] = opts.authorization;
    axios
      .post(
        `${apiBaseUrl.replace(/\/+$/, '')}/v1/memories/turn`,
        {
          user: opts.transcription.slice(0, 500),
          assistant: opts.assistantText.slice(0, 1000),
          language: opts.language,
        },
        { headers, timeout: 5000 },
      )
      .catch(() => { /* fire-and-forget — never blocks the response */ });
  }

  private async safeTts(input: { userId: string; text: string }) {
    try {
      const result = await this.ttsFactory.synthesize(input.text);
      return result.audio.toString('base64');
    } catch {
      return null;
    }
  }

  private fallbackText(language: SupportedLanguage, err?: any) {
    const status = Number(err?.status || err?.response?.status || 0);
    const isBackpressure = status === 429 || status >= 500;
    if (language === 'es') {
      return isBackpressure
        ? 'Ahora mismo estoy ocupada. Dime en una frase corta qué necesitas y lo intento de nuevo.'
        : 'Algo salió mal. ¿Puedes repetirlo en una frase corta?';
    }

    return isBackpressure
      ? 'I’m a bit busy right now. Tell me what you need in one short sentence and I’ll try again.'
      : 'Something went wrong. Can you repeat it in one short sentence?';
  }

  private normalizeLanguage(raw?: string): SupportedLanguage {
    const s = String(raw || '')
      .trim()
      .toLowerCase();
    if (s === 'es' || s.startsWith('es-')) return 'es';
    if (s === 'en' || s.startsWith('en-')) return 'en';
    if (s === 'pt' || s.startsWith('pt-')) return 'pt';
    if (s === 'fr' || s.startsWith('fr-')) return 'fr';
    if (s === 'ja' || s.startsWith('ja-')) return 'ja';
    return 'en';
  }

  private buildAssistantText(intent: IntentResult, actionResult: any) {
    const base = String(intent?.assistant_text || '').trim();
    if (base) return base;

    const i = String(intent?.intent || '').trim();
    if (i === 'create_task') return 'Done. I created the task.';
    if (i === 'send_email') return 'Done. I sent the email.';
    if (i === 'agenda_today') return 'Here is your agenda for today.';

    if (actionResult?.fallback_text) return String(actionResult.fallback_text);
    return 'Done.';
  }

  private async dispatchAction(input: {
    intent: IntentResult;
    userId: string;
    authorization?: string;
    confirmation?: 'confirmed' | 'cancel';
    pendingEventId?: string;
    pendingAttendeeName?: string;
    language?: string;
  }) {
    const apiBaseUrl = String(process.env.API_BASE_URL || process.env.API_URL || '').trim();
    if (!apiBaseUrl) {
      return {
        ok: false,
        fallback_text:
          input.intent.assistant_text || 'I can help, but API_BASE_URL is not configured.',
      };
    }

    const headers: Record<string, string> = {};
    if (input.authorization) headers.authorization = input.authorization;

    const intent = String(input.intent.intent || '').trim();
    const slots = input.intent.slots || {};

    try {
      if (input.intent.needs_confirmation && input.confirmation !== 'confirmed') {
        return { ok: true, deferred: true };
      }

      if (intent === 'create_task') {
        const title = String(slots.title || '').trim();
        if (!title) return { ok: false, fallback_text: 'What is the task title?' };
        const res = await axios.post(
          `${apiBaseUrl.replace(/\/+$/, '')}/v1/tasks`,
          {
            title,
            due_at: slots.date || undefined,
            description: slots.notes || undefined,
          },
          { headers },
        );
        return { ok: true, provider: 'api', endpoint: '/v1/tasks', data: res.data };
      }

      if (intent === 'complete_task') {
        const id = String(slots.task_id || '').trim();
        const title = String(slots.task_title || '').trim();
        const res = await axios.post(
          `${apiBaseUrl.replace(/\/+$/, '')}/v1/tasks/complete`,
          { task_id: id || undefined, task_title: title || undefined },
          { headers },
        );
        return { ok: true, provider: 'api', endpoint: '/v1/tasks/complete', data: res.data };
      }

      if (intent === 'create_reminder') {
        const title = String(slots.title || '').trim();
        const datetime = String(slots.datetime || '').trim();
        if (!title) return { ok: false, fallback_text: 'What is the reminder for?' };
        if (!datetime) return { ok: false, fallback_text: 'When should I remind you?' };
        const res = await axios.post(
          `${apiBaseUrl.replace(/\/+$/, '')}/v1/reminders`,
          { title, datetime, recurrence: slots.recurrence || undefined },
          { headers },
        );
        return { ok: true, provider: 'api', endpoint: '/v1/reminders', data: res.data };
      }

      if (intent === 'send_email') {
        const to = String(slots.to || '').trim();
        const subject = String(slots.subject || '').trim();
        const body = String(slots.body || '').trim();
        const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!to) return { ok: false, fallback_text: '¿A quién le envío el correo? Dime el email exacto.' };
        if (!EMAIL_RE.test(to)) return { ok: false, fallback_text: `"${to}" no parece un correo válido. ¿Me lo puedes dictar letra por letra?` };
        if (!subject) return { ok: false, fallback_text: '¿Cuál es el asunto del correo?' };
        if (!body) return { ok: false, fallback_text: '¿Qué quieres que diga el correo?' };
        const res = await axios.post(
          `${apiBaseUrl.replace(/\/+$/, '')}/v1/email/send`,
          { to, subject, body },
          { headers },
        );
        return { ok: true, provider: 'api', endpoint: '/v1/email/send', data: res.data };
      }

      if (intent === 'send_sms') {
        const to = String(slots.to || '').trim();
        const body = String(slots.body || '').trim();
        if (!to) return { ok: false, fallback_text: 'Who should I text?' };
        if (!body) return { ok: false, fallback_text: 'What should the message say?' };
        const res = await axios.post(
          `${apiBaseUrl.replace(/\/+$/, '')}/v1/sms/send`,
          { to, body },
          { headers },
        );
        return { ok: true, provider: 'api', endpoint: '/v1/sms/send', data: res.data };
      }

      if (intent === 'agenda_date') {
        const day = String(slots.date || '').trim();
        if (!day) return { ok: false, fallback_text: 'What date?' };
        const res = await axios.get(`${apiBaseUrl.replace(/\/+$/, '')}/v1/calendar/agenda`, {
          headers,
          params: { day },
        });
        return { ok: true, provider: 'api', endpoint: '/v1/calendar/agenda', data: res.data };
      }

      if (intent === 'create_event') {
        const title = String(slots.title || '').trim();
        const date = String(slots.date || '').trim();
        const time = String(slots.time || '').trim();
        if (!title) return { ok: false, fallback_text: '¿Cuál es el título del evento?' };
        if (!date) return { ok: false, fallback_text: '¿Para qué fecha es el evento?' };
        if (!time) return { ok: false, fallback_text: '¿A qué hora es el evento?' };

        const startAt = `${date}T${time}`;
        const durationMinutesRaw = String(slots.duration || '').trim();
        const durationMinutes = durationMinutesRaw ? Number(durationMinutesRaw) : NaN;
        const endAt = Number.isFinite(durationMinutes)
          ? new Date(new Date(startAt).getTime() + durationMinutes * 60_000).toISOString()
          : undefined;

        const res = await axios.post(
          `${apiBaseUrl.replace(/\/+$/, '')}/v1/calendar/events`,
          {
            title,
            start_at: startAt,
            ...(endAt ? { end_at: endAt } : {}),
            location: slots.location || undefined,
          },
          { headers },
        );
        return {
          ok: true,
          provider: 'api',
          endpoint: '/v1/calendar/events',
          data: res.data,
          status: 'awaiting_attendees',
          event_id: res.data?.id,
        };
      }

      if (intent === 'add_attendees') {
        const eventId = String(input.pendingEventId || '').trim();
        if (!eventId) return { ok: false, fallback_text: '¿A qué evento quieres agregar invitados?' };

        const rawAttendees = String(slots.attendees || '').trim();
        if (!rawAttendees) return { ok: false, fallback_text: '¿A quién quieres invitar?' };

        const names = rawAttendees
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean);

        const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const resolved: Array<{ name: string; email: string }> = [];
        const unresolved: string[] = [];

        for (const nameOrEmail of names) {
          if (EMAIL_RE.test(nameOrEmail)) {
            resolved.push({ name: nameOrEmail.split('@')[0], email: nameOrEmail });
            continue;
          }
          // Look up contact by name in the API
          try {
            const searchRes = await axios.get(
              `${apiBaseUrl.replace(/\/+$/, '')}/v1/contacts/search`,
              { headers, params: { q: nameOrEmail }, timeout: 10000 },
            );
            const contacts: any[] = Array.isArray(searchRes.data?.contacts)
              ? searchRes.data.contacts
              : [];
            const match = contacts.find((c: any) => c?.email);
            if (match?.email) {
              resolved.push({ name: match.name || nameOrEmail, email: match.email });
            } else {
              unresolved.push(nameOrEmail);
            }
          } catch {
            unresolved.push(nameOrEmail);
          }
        }

        if (unresolved.length > 0) {
          const firstUnresolved = unresolved[0];
          return {
            ok: true,
            status: 'awaiting_attendee_email',
            event_id: eventId,
            resolved,
            unresolved,
            fallback_text:
              input.language === 'es' || !input.language
                ? `No tengo el correo de ${firstUnresolved}. ¿Me lo dictas?`
                : `I don't have an email for ${firstUnresolved}. Can you give it to me?`,
          };
        }

        // All resolved — add them
        const addRes = await axios.post(
          `${apiBaseUrl.replace(/\/+$/, '')}/v1/calendar/events/${eventId}/attendees`,
          { attendees: resolved },
          { headers },
        );

        const meetLink = addRes.data?.event?.meet_link || null;
        const nameList = resolved.map((a) => a.name).join(', ');
        return {
          ok: true,
          provider: 'api',
          endpoint: `/v1/calendar/events/${eventId}/attendees`,
          data: addRes.data,
          resolved,
          fallback_text:
            input.language === 'es' || !input.language
              ? `Listo. Invité a ${nameList}.${meetLink ? ` El link de Meet es ${meetLink}` : ''}`
              : `Done. I invited ${nameList}.${meetLink ? ` Meet link: ${meetLink}` : ''}`,
        };
      }

      if (intent === 'resolve_attendee_email') {
        const eventId = String(input.pendingEventId || '').trim();
        const email = String(slots.email || '').trim();
        const attendeeName = String(slots.attendee_name || input.pendingAttendeeName || '').trim();

        const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !EMAIL_RE.test(email)) {
          return {
            ok: false,
            fallback_text:
              input.language === 'es' || !input.language
                ? `"${email}" no parece un correo válido. ¿Me lo dictas letra por letra?`
                : `"${email}" doesn't look like a valid email. Can you spell it out?`,
          };
        }

        if (!eventId) {
          return { ok: false, fallback_text: '¿A qué evento pertenece este invitado?' };
        }

        const attendee = { name: attendeeName || email.split('@')[0], email };
        const addRes = await axios.post(
          `${apiBaseUrl.replace(/\/+$/, '')}/v1/calendar/events/${eventId}/attendees`,
          { attendees: [attendee] },
          { headers },
        );
        const meetLink = addRes.data?.event?.meet_link || null;
        return {
          ok: true,
          provider: 'api',
          endpoint: `/v1/calendar/events/${eventId}/attendees`,
          data: addRes.data,
          fallback_text:
            input.language === 'es' || !input.language
              ? `Listo, agregué a ${attendee.name} (${email}).${meetLink ? ` Meet: ${meetLink}` : ''}`
              : `Done, added ${attendee.name} (${email}).${meetLink ? ` Meet: ${meetLink}` : ''}`,
        };
      }

      if (intent === 'add_to_cart') {
        const store = String(slots.store || '').trim();
        const items = String(slots.items || '').trim();
        if (!store)
          return { ok: false, fallback_text: 'Which store? Amazon, Instacart, or Walmart?' };
        if (!items) return { ok: false, fallback_text: 'What items should I add?' };
        const res = await axios.post(
          `${apiBaseUrl.replace(/\/+$/, '')}/v1/cart/add`,
          { store, items },
          { headers },
        );
        return { ok: true, provider: 'api', endpoint: '/v1/cart/add', data: res.data };
      }

      if (intent === 'play_media') {
        const platform = String(slots.platform || '').trim();
        const query = String(slots.query || '').trim();
        if (!platform) return { ok: false, fallback_text: 'YouTube or Spotify?' };
        if (!query) return { ok: false, fallback_text: 'What should I play?' };
        const res = await axios.post(
          `${apiBaseUrl.replace(/\/+$/, '')}/v1/media/play`,
          { platform, query },
          { headers },
        );
        return { ok: true, provider: 'api', endpoint: '/v1/media/play', data: res.data };
      }

      if (intent === 'save_memory') {
        const content = String(slots.content || '').trim();
        const category = String(slots.category || '').trim();
        if (!content) return { ok: false, fallback_text: 'What should I remember?' };
        if (!category)
          return {
            ok: false,
            fallback_text: 'What category is it? birthday, school, contact, or goal?',
          };
        const res = await axios.post(
          `${apiBaseUrl.replace(/\/+$/, '')}/v1/memories/save`,
          { content, category },
          { headers },
        );
        return { ok: true, provider: 'api', endpoint: '/v1/memories/save', data: res.data };
      }

      if (intent === 'school_email_check') {
        const res = await axios.get(`${apiBaseUrl.replace(/\/+$/, '')}/v1/email/school-scan`, {
          headers,
        });
        return {
          ok: true,
          provider: 'api',
          endpoint: '/v1/email/school-scan',
          data: res.data,
        };
      }

      if (intent === 'set_goal') {
        const title = String(slots.title || '').trim();
        if (!title) return { ok: false, fallback_text: 'What is the goal?' };
        const res = await axios.post(
          `${apiBaseUrl.replace(/\/+$/, '')}/v1/goals`,
          {
            title,
            target_date: slots.target_date || undefined,
            category: slots.category || undefined,
          },
          { headers },
        );
        return { ok: true, provider: 'api', endpoint: '/v1/goals', data: res.data };
      }

      if (intent === 'daily_verse') {
        const res = await axios.get(`${apiBaseUrl.replace(/\/+$/, '')}/v1/verse/daily`, {
          headers,
        });
        return { ok: true, provider: 'api', endpoint: '/v1/verse/daily', data: res.data };
      }

      if (intent === 'suggest_meal') {
        // Conversational — Claude responds directly with meal suggestions
        return { ok: true, provider: 'none', endpoint: null, data: null };
      }

      if (intent === 'get_recipe') {
        // Conversational — Claude responds directly with the recipe
        return { ok: true, provider: 'none', endpoint: null, data: null };
      }

      if (intent === 'recommend_restaurant') {
        // Conversational — Claude responds directly with restaurant recommendations
        return { ok: true, provider: 'none', endpoint: null, data: null };
      }

      if (intent === 'emotional_support') {
        return { ok: true, provider: 'none', endpoint: null, data: null };
      }

      if (intent === 'chat') {
        return { ok: true, provider: 'none', endpoint: null, data: null };
      }

      if (intent === 'make_call') {
        const contactName = String(slots.contact_name || '').trim();
        const directNumber = String(slots.phone_number || '').trim();

        if (directNumber) {
          const clean = directNumber.replace(/[^\d+]/g, '');
          return { ok: true, provider: 'phone', phone_number: clean, contact_name: contactName || directNumber };
        }

        if (!contactName) {
          return {
            ok: false,
            fallback_text: input.language === 'es' ? '¿A quién quieres llamar?' : 'Who would you like to call?',
          };
        }

        try {
          const searchRes = await axios.get(
            `${apiBaseUrl.replace(/\/+$/, '')}/v1/contacts/search`,
            { headers, params: { q: contactName }, timeout: 10000 },
          );
          const contacts: any[] = Array.isArray(searchRes.data?.contacts) ? searchRes.data.contacts : [];
          const match = contacts.find((c: any) => c?.phone);
          if (match?.phone) {
            const clean = String(match.phone).replace(/[^\d+]/g, '');
            return { ok: true, provider: 'phone', phone_number: clean, contact_name: match.name || contactName };
          }
          const errMsg = contacts.length > 0
            ? (input.language === 'es'
                ? `Encontré a ${contactName} pero no tengo su número. ¿Me lo dictas?`
                : `I found ${contactName} but don't have their number. What is it?`)
            : (input.language === 'es'
                ? `No encontré a ${contactName} en tus contactos. ¿Me das el número?`
                : `I couldn't find ${contactName} in your contacts. What's their number?`);
          return { ok: false, fallback_text: errMsg };
        } catch {
          return {
            ok: false,
            fallback_text: input.language === 'es'
              ? `No pude encontrar el número de ${contactName}.`
              : `Couldn't find ${contactName}'s number.`,
          };
        }
      }

      if (intent === 'agenda_today') {
        const res = await axios.get(`${apiBaseUrl.replace(/\/+$/, '')}/v1/calendar/agenda/today`, {
          headers,
        });
        return {
          ok: true,
          provider: 'api',
          endpoint: '/v1/calendar/agenda/today',
          data: res.data,
          _agendaData: res.data,
        };
      }

      return { ok: true, provider: 'none', endpoint: null, data: null };
    } catch (err: any) {
      const status = err?.response?.status;
      const message = err?.response?.data || String(err);
      return {
        ok: false,
        provider: 'api',
        endpoint: null,
        error: { status, message },
        fallback_text: input.intent.assistant_text || 'Something went wrong. Please try again.',
      };
    }
  }
}
