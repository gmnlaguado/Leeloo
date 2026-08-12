import { Injectable } from '@nestjs/common';
import axios from 'axios';
import {
  LEELOO_SYSTEM_PROMPT,
  LEELOO_SYSTEM_PROMPT_VERSION,
  buildSystemPrompt,
  type LeelooPersonality,
} from '@leeloo/ai-prompts';
import { OpenAiQueue } from './workers/openai.queue';

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
  constructor(private readonly openAiQueue: OpenAiQueue) {}

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

    const systemPrompt = input.userName
      ? buildSystemPrompt(personality, input.userName, {
          todayTasks: [],
          upcomingEvents: [],
          pendingApprovals: 0,
          timeOfDay,
        })
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
    });

    const assistantText = this.buildAssistantText(intent, actionResult);

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
      });
      const confirmedText = this.buildAssistantText(intent, confirmedAction);
      const ttsAudioBase64 = await this.safeTts({ userId: input.userId, text: confirmedText });
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

    const ttsAudioBase64 = await this.safeTts({
      userId: input.userId,
      text: assistantText,
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

  private async safeTts(input: { userId: string; text: string }) {
    try {
      return await this.openAiQueue.tts({
        userId: input.userId,
        text: input.text,
        voice: 'nova',
        model: 'tts-1-hd',
      });
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
        if (!to) return { ok: false, fallback_text: 'Who should I email?' };
        if (!subject) return { ok: false, fallback_text: 'What is the email subject?' };
        if (!body) return { ok: false, fallback_text: 'What should the email say?' };
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
        if (!title) return { ok: false, fallback_text: 'What is the event title?' };
        if (!date) return { ok: false, fallback_text: 'What date is it?' };
        if (!time) return { ok: false, fallback_text: 'What time is it?' };

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
            notes: undefined,
          },
          { headers },
        );
        return { ok: true, provider: 'api', endpoint: '/v1/calendar/events', data: res.data };
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

      if (intent === 'agenda_today') {
        const res = await axios.get(`${apiBaseUrl.replace(/\/+$/, '')}/v1/calendar/agenda/today`, {
          headers,
        });
        return { ok: true, provider: 'api', endpoint: '/v1/calendar/agenda/today', data: res.data };
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
