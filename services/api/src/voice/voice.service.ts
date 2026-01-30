import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import FormData = require('form-data');
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import { TasksService } from '../tasks/tasks.service';
import { MemoriesService } from '../memories/memories.service';
import { DatabaseService } from '../database/database.service';
import { ProfilesService, SupportedLanguage } from '../profiles/profiles.service';
import { R2Service } from '../r2/r2.service';
import { EmailService } from '../email/email.service';
import { CalendarService } from '../calendar/calendar.service';
import { buildLeelooUniversalPrompt } from './core/leeloo-core.prompt';
import { detectEmotionHeuristic, emotionLeadSentence } from './core/emotion';
import { computeConfidence, computeSlotConfidence } from './core/confidence';
import { decide } from './core/decision-engine';
import { InputNormalizer } from './core/input-normalizer';
import { ExecutiveSupervisor } from './core/executive-supervisor';
import { FactIngestor } from './core/fact-ingestor';
import { ExecutiveBrain } from './core/executive-brain';

@Injectable()
export class VoiceService {
  private readonly openai: OpenAI | null;
  private llmVoiceCircuitOpenedAtMs: number | null = null;
  private voiceIntentLlmDisabledUntilMs: number | null = null;
  private voiceIntentLlmFailureStreak: number = 0;

  private isCoreIntent(intentName: string): boolean {
    const name = String(intentName || '').trim();
    if (!name) return false;
    const core = new Set([
      'create_task',
      'list_tasks',
      'complete_task',
      'send_email',
      'create_reminder',
      'reminder',
      'schedule_meeting',
      'delete_event',
      'update_event_time',
      'agenda_today',
      'agenda_tomorrow',
      'set_language',
      'help',
    ]);
    return core.has(name);
  }

  private logVoiceMetrics(payload: {
    request_id: string | null;
    user_id: string;
    channel: 'VOICE' | 'TEXT';
    wake_word_only: boolean;
    intent: string;
    intent_source: string | null;
    core_intent_matched: boolean;
    fallback_used: boolean;
    router_ms: number;
    stt_ms: number | null;
    llm_intent_ms: number | null;
    llm_response_ms: number | null;
    total_ms: number;
  }) {
    console.log('[LeelooApi] voice.metrics', payload);
  }

  private llmTimeoutMs() {
    const raw = this.configService.get<string>('LLM_TIMEOUT_MS');
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return 120000;
  }

  private llmTimeoutMsForChannel(channel: 'VOICE' | 'TEXT') {
    if (channel === 'VOICE') {
      const raw = this.configService.get<string>('LLM_TIMEOUT_MS_VOICE');
      const parsed = raw ? Number(raw) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
      return 18000;
    }

    return this.llmTimeoutMs();
  }

  private openVoiceLlmCircuit() {
    this.llmVoiceCircuitOpenedAtMs = Date.now();
  }

  private isVoiceLlmCircuitOpen() {
    if (!this.llmVoiceCircuitOpenedAtMs) return false;
    return Date.now() - this.llmVoiceCircuitOpenedAtMs < 25000;
  }

  private isVoiceIntentLlmDisabled() {
    if (!this.voiceIntentLlmDisabledUntilMs) return false;
    if (Date.now() >= this.voiceIntentLlmDisabledUntilMs) {
      this.voiceIntentLlmDisabledUntilMs = null;
      this.voiceIntentLlmFailureStreak = 0;
      return false;
    }
    return true;
  }

  private recordVoiceIntentLlmFailure() {
    this.voiceIntentLlmFailureStreak = Math.min(10, (this.voiceIntentLlmFailureStreak || 0) + 1);
    if (this.voiceIntentLlmFailureStreak >= 2) {
      const raw = this.configService.get<string>('VOICE_INTENT_LLM_DISABLE_MS') || '25000';
      const n = Number(raw);
      const ms = Number.isFinite(n) && n >= 1000 && n <= 180000 ? Math.floor(n) : 25000;
      this.voiceIntentLlmDisabledUntilMs = Date.now() + ms;
    }
  }

  private recordVoiceIntentLlmSuccess() {
    this.voiceIntentLlmFailureStreak = 0;
    this.voiceIntentLlmDisabledUntilMs = null;
  }

  private closeVoiceLlmCircuit() {
    this.llmVoiceCircuitOpenedAtMs = null;
  }

  private inferDeterministicIntent(
    text: string,
    language: SupportedLanguage,
  ):
    | {
        intent: string;
        language: SupportedLanguage | null;
        confidence: number;
        required_slots: string[];
        filled_slots: Record<string, any>;
        missing_slots: string[];
        next_question: string;
        priority: 'low' | 'medium' | 'high';
        intent_source?: string;
      }
    | null {
    const rawInput = String(text || '').trim();
    if (!rawInput) return null;

    const normalize = (s: string) =>
      String(s || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9\s@._-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const stripPrefixes = (s: string) =>
      s
        .replace(/^\s*(hey|hi|hola|oye)\s+/i, '')
        .replace(/^\s*(leeloo|lilo|lilu|lelu|lelo)[,\s]+/i, '')
        .replace(/^\s*(please|por favor)\s+/i, '')
        .trim();

    const raw = stripPrefixes(rawInput);
    if (!raw) return null;

    const lower = normalize(raw);

    const parseDateTimeIso = (s: string): string | null => {
      try {
        const mDate = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
        if (!mDate) return null;

        const year = Number(mDate[1]);
        const month = Number(mDate[2]);
        const day = Number(mDate[3]);
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

        const mTime = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
        if (!mTime) return null;

        let hh = Number(mTime[1]);
        const mm = mTime[2] ? Number(mTime[2]) : 0;
        const ampm = (mTime[3] || '').toLowerCase();
        if (ampm === 'pm' && hh >= 1 && hh <= 11) hh += 12;
        if (ampm === 'am' && hh === 12) hh = 0;
        if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

        const iso = new Date(Date.UTC(year, month - 1, day, hh, mm, 0)).toISOString();
        if (Number.isNaN(new Date(iso).getTime())) return null;
        return iso;
      } catch {
        return null;
      }
    };

    const parseDateTimeSpanishBasic = (s: string): string | null => {
      const months: Record<string, number> = {
        enero: 1,
        febrero: 2,
        marzo: 3,
        abril: 4,
        mayo: 5,
        junio: 6,
        julio: 7,
        agosto: 8,
        septiembre: 9,
        setiembre: 9,
        octubre: 10,
        noviembre: 11,
        diciembre: 12,
      };

      const m = s.match(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
      if (!m) return null;

      const day = Number(m[1]);
      const month = months[String(m[2] || '')] || 0;
      if (!day || !month) return null;

      const t = s.match(/\b(a\s+las|at)\s+(\d{1,2})(?::(\d{2}))?\b/);
      if (!t) return null;

      const hh = Number(t[2]);
      const mm = t[3] ? Number(t[3]) : 0;
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

      const now = new Date();
      const year = now.getUTCFullYear();
      const iso = new Date(Date.UTC(year, month - 1, day, hh, mm, 0)).toISOString();
      if (Number.isNaN(new Date(iso).getTime())) return null;
      return iso;
    };

    const parsedStartAt = parseDateTimeIso(lower) || parseDateTimeSpanishBasic(lower);

    const deleteTrigger =
      /\b(delete|remove|cancel)\b/.test(lower) ||
      /\b(elimina|borrar|borra|cancela|cancelar|quita)\b/.test(lower);
    const hasEventWord = /\b(event|appointment|meeting|calendario|evento|cita|reunion|reuni[oó]n)\b/.test(lower);

    if (deleteTrigger && hasEventWord) {
      const titleQuery = raw
        .replace(/\b(delete|remove|cancel)\b\s*/i, '')
        .replace(/\b(elimina|borrar|borra|cancela|cancelar|quita)\b\s*/i, '')
        .replace(/\b(event|appointment|meeting|calendario|evento|cita|reunion|reuni[oó]n)\b\s*/i, '')
        .trim();

      const filled: Record<string, any> = {};
      if (titleQuery) filled.title_query = titleQuery;

      const missing: string[] = [];
      if (!String(filled.title_query || '').trim()) missing.push('title_query');

      const next_question = missing[0] === 'title_query'
        ? (language === 'es' ? '¿Cuál evento quieres eliminar? Dime el título o una parte.' : 'Which event should I delete? Say the title or part of it.')
        : '';

      return {
        intent: 'delete_event',
        language: null,
        confidence: 0.78,
        required_slots: ['title_query'],
        filled_slots: filled,
        missing_slots: missing,
        next_question,
        priority: 'high',
        intent_source: 'deterministic',
      };
    }

    const updateTrigger =
      /\b(reschedule|move|change|update)\b/.test(lower) ||
      /\b(cambia|mueve|reprograma|reagenda)\b/.test(lower);
    const timeWord = /\b(time|hora|para|a\s+las|at)\b/.test(lower);

    if (updateTrigger && hasEventWord && timeWord) {
      const titleQuery = raw
        .replace(/\b(reschedule|move|change|update)\b\s*/i, '')
        .replace(/\b(cambia|mueve|reprograma|reagenda)\b\s*/i, '')
        .replace(/\b(el|la)\b\s*/i, '')
        .replace(/\b(event|appointment|meeting|calendario|evento|cita|reunion|reuni[oó]n)\b\s*/i, '')
        .replace(/\b(to|for|para)\b\s+.+$/i, '')
        .trim();

      const filled: Record<string, any> = {};
      if (titleQuery) filled.title_query = titleQuery;
      if (parsedStartAt) filled.start_at = parsedStartAt;

      const missing: string[] = [];
      if (!String(filled.title_query || '').trim()) missing.push('title_query');
      if (!String(filled.start_at || '').trim()) missing.push('start_at');

      const next_question = missing[0] === 'title_query'
        ? (language === 'es' ? '¿Qué evento quieres cambiar? Dime el título o una parte.' : 'Which event do you want to change? Say the title or part of it.')
        : missing[0] === 'start_at'
          ? (language === 'es' ? '¿Para qué fecha y hora?' : 'What date and time?')
          : '';

      return {
        intent: 'update_event_time',
        language: null,
        confidence: 0.76,
        required_slots: ['title_query', 'start_at'],
        filled_slots: filled,
        missing_slots: missing,
        next_question,
        priority: 'high',
        intent_source: 'deterministic',
      };
    }

    const meetingTrigger =
      /\b(schedule|meeting|appointment|event)\b/.test(lower) ||
      /\b(reunion|reuni[oó]n|cita|evento|calendario)\b/.test(lower);

    if (meetingTrigger) {
      const title = raw
        .replace(/\b(schedule|meeting|appointment|event)\b\s*/i, '')
        .replace(/\b(programa|agenda|reunion|reuni[oó]n|cita|evento|calendario)\b\s*/i, '')
        .trim();

      const filled: Record<string, any> = {};
      if (title) filled.title = title;
      if (parsedStartAt) filled.start_at = parsedStartAt;

      const missing: string[] = [];
      if (!String(filled.title || '').trim()) missing.push('title');
      if (!String(filled.start_at || '').trim()) missing.push('start_at');

      const next_question = (() => {
        if (missing[0] === 'title') return language === 'es' ? '¿Qué título le pongo al evento?' : "What's the event title?";
        if (missing[0] === 'start_at') return language === 'es' ? '¿Para cuándo es? (di fecha y hora)' : 'When is it? (say date and time)';
        return '';
      })();

      return {
        intent: 'schedule_meeting',
        language: null,
        confidence: 0.78,
        required_slots: ['title', 'start_at'],
        filled_slots: filled,
        missing_slots: missing,
        next_question,
        priority: 'medium',
        intent_source: 'deterministic',
      };
    }

    const wantsLanguage =
      /\b(set\s+language|change\s+language|language)\b/.test(lower) ||
      /\b(cambia\s+idioma|cambiar\s+idioma|pon\s+idioma|idioma)\b/.test(lower) ||
      /\b(speak|habla|hablame)\b/.test(lower) ||
      /\b(in|en)\s+(english|ingles|inglés|spanish|espanol|español|portuguese|portugues|portugues|french|frances|francais|japanese|japones|japonés)\b/.test(lower);

    if (wantsLanguage) {
      const lang = (() => {
        if (/\b(english|ingles|inglés)\b/.test(lower)) return 'en';
        if (/\b(spanish|espanol|español)\b/.test(lower)) return 'es';
        if (/\b(portuguese|portugues|portugues)\b/.test(lower)) return 'pt';
        if (/\b(french|frances|francais)\b/.test(lower)) return 'fr';
        if (/\b(japanese|japones|japonés|nihongo)\b/.test(lower)) return 'ja';
        return null;
      })();

      if (lang) {
        return {
          intent: 'set_language',
          language: lang,
          confidence: 0.82,
          required_slots: [],
          filled_slots: { language: lang },
          missing_slots: [],
          next_question: '',
          priority: 'medium',
          intent_source: 'deterministic',
        };
      }
    }

    const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const hasEmail = Boolean(emailMatch && emailMatch[0]);

    const wantsEmail =
      /\b(send|email|mail)\b/i.test(lower) ||
      /\b(enviar|correo|mail)\b/i.test(lower) ||
      hasEmail;

    if (wantsEmail) {
      const filled: Record<string, any> = {};
      if (hasEmail) filled.to = emailMatch?.[0];

      const bodyCandidate = raw
        .replace(emailMatch?.[0] || '', '')
        .replace(/\b(to|a)\b\s*:?/i, '')
        .replace(/\b(send|email|mail|enviar|correo)\b\s*/i, '')
        .trim();

      if (bodyCandidate && bodyCandidate.length >= 6) {
        filled.body = bodyCandidate;
      }

      const missing: string[] = [];
      if (!String(filled.to || '').trim()) missing.push('to');
      if (!String(filled.body || '').trim()) missing.push('body');

      const next_question =
        missing[0] === 'to'
          ? language === 'es'
            ? '¿A qué correo quieres que lo envíe?'
            : 'What email address should I send it to?'
          : missing[0] === 'body'
            ? language === 'es'
              ? '¿Qué quieres que diga el correo?'
              : 'What should the email say?'
            : '';

      return {
        intent: 'send_email',
        language: null,
        confidence: 0.82,
        required_slots: ['to', 'body'],
        filled_slots: filled,
        missing_slots: missing,
        next_question,
        priority: 'high',
        intent_source: 'deterministic',
      };
    }

    const wantsTask =
      /\b(create|add|make)\s+(a\s+)?task\b/i.test(lower) ||
      /\bnew\s+task\b/i.test(lower) ||
      /\b(create_task)\b/i.test(lower) ||
      /\b(crea|crear|agrega|añade)\s+(una\s+)?tarea\b/i.test(lower);

    if (wantsTask) {
      const title = raw
        .replace(/\b(create|add|make)\s+(a\s+)?task\b\s*/i, '')
        .replace(/\bnew\s+task\b\s*/i, '')
        .replace(/\b(crea|crear|agrega|añade)\s+(una\s+)?tarea\b\s*/i, '')
        .trim();

      const missing: string[] = [];
      const filled: Record<string, any> = {};
      if (title) filled.title = title;
      if (!String(filled.title || '').trim()) missing.push('title');

      const next_question =
        missing[0] === 'title'
          ? this.buildMissingTaskTitleMessage(language)
          : '';

      return {
        intent: 'create_task',
        language: null,
        confidence: 0.8,
        required_slots: ['title'],
        filled_slots: filled,
        missing_slots: missing,
        next_question,
        priority: 'high',
        intent_source: 'deterministic',
      };
    }

    const wantsReminder =
      /\bremind\s+me\b/i.test(lower) ||
      /\breminder\b/i.test(lower) ||
      /\brec(u|ú)erdame\b/i.test(lower) ||
      /\brecordatorio\b/i.test(lower) ||
      /\balexa\s+recordatorio\b/i.test(lower);

    if (wantsReminder) {
      const activity = raw
        .replace(/\bremind\s+me\b\s*/i, '')
        .replace(/\breminder\b\s*/i, '')
        .replace(/\brec(u|ú)erdame\b\s*/i, '')
        .replace(/\brecordatorio\b\s*/i, '')
        .replace(/\balexa\b\s*/i, '')
        .trim();

      const filled: Record<string, any> = {};
      if (activity) filled.activity = activity;
      if (parsedStartAt) filled.start_at = parsedStartAt;
      const missing: string[] = [];
      if (!String(filled.activity || '').trim()) missing.push('activity');
      if (!String(filled.start_at || '').trim()) missing.push('start_at');

      const next_question =
        missing[0] === 'activity'
          ? language === 'es'
            ? '¿Qué quieres que te recuerde?'
            : 'What should I remind you about?'
          : missing[0] === 'start_at'
            ? language === 'es'
              ? '¿Para cuándo? Dime fecha y hora.'
              : 'When? Tell me date and time.'
            : '';

      return {
        intent: 'reminder',
        language: null,
        confidence: 0.75,
        required_slots: ['activity', 'start_at'],
        filled_slots: filled,
        missing_slots: missing,
        next_question,
        priority: 'medium',
        intent_source: 'deterministic',
      };
    }

    return null;
  }

  private trimForVoicePrompt(value: string, maxChars: number) {
    const s = String(value || '');
    if (s.length <= maxChars) return s;
    return s.slice(0, maxChars);
  }

  private createTraceId(prefix: string) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private truncate(value: any, max = 800): string {
    try {
      const str =
        typeof value === 'string'
          ? value
          : value instanceof Buffer
            ? value.toString('utf8')
            : JSON.stringify(value);
      return str.length > max ? `${str.slice(0, max)}…(truncated ${str.length - max})` : str;
    } catch {
      try {
        return String(value);
      } catch {
        return '[unprintable]';
      }
    }
  }

  private axiosErrorSummary(err: any) {
    const status = err?.response?.status;
    const method = err?.config?.method;
    const url = err?.config?.url;
    const data = err?.response?.data;
    return {
      status,
      method,
      url,
      data_preview: data ? this.truncate(data, 1200) : undefined,
      message: err?.message,
      code: err?.code,
    };
  }

  constructor(
    private configService: ConfigService,
    private tasksService: TasksService,
    private memoriesService: MemoriesService,
    private db: DatabaseService,
    private profilesService: ProfilesService,
    private r2: R2Service,
    private emailService: EmailService,
    private calendarService: CalendarService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.openai = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async transcribeAudio(
    audioBuffer: Buffer,
    userContext?: { language?: string; wake_word_only?: boolean },
  ): Promise<string> {
    if (!audioBuffer || audioBuffer.length === 0) {
      return '';
    }

    const traceId = (userContext as any)?.trace_id || this.createTraceId('voice');
    const startedAt = Date.now();

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const isRateLimited = (err: any) => {
      const status = err?.response?.status;
      if (status === 429) return true;
      const data = err?.response?.data;
      if (typeof data === 'string' && data.includes('Just a moment')) return true;
      return false;
    };

    const endpoint =
      this.configService.get<string>('STT_ENDPOINT') ||
      this.configService.get<string>('WHISPER_ENDPOINT');

    const preferOpenAI = String(this.configService.get<string>('STT_PREFER_OPENAI') || 'true').toLowerCase() !== 'false';

    const fallbackOnEmptyGlobal =
      String(this.configService.get<string>('STT_FALLBACK_ON_EMPTY') || 'false').toLowerCase() === 'true';

    const fallbackOnEmptyWake =
      String(this.configService.get<string>('STT_FALLBACK_ON_EMPTY_WAKE') || 'true').toLowerCase() !== 'false';

    const wakeWordOnly = Boolean((userContext as any)?.wake_word_only);

    const fallbackOnEmpty = fallbackOnEmptyGlobal || (wakeWordOnly && fallbackOnEmptyWake);

    const sttWakeTimeoutMs = (() => {
      const raw = this.configService.get<string>('STT_WAKE_ENDPOINT_TIMEOUT_MS') || '2500';
      const n = Number(raw);
      return Number.isFinite(n) && n >= 250 && n <= 20000 ? Math.floor(n) : 2500;
    })();

    const language = (userContext?.language || 'en').toLowerCase();

    const detectLikelyLanguage = (text: string): 'en' | 'es' | 'unknown' => {
      const t = String(text || '').toLowerCase();
      if (!t.trim()) return 'unknown';

      // Lightweight heuristic (no extra deps): sufficient to detect "obvious" Spanish.
      const esHits = [
        ' el ', ' la ', ' los ', ' las ', ' un ', ' una ', ' por ', ' para ', ' con ', ' sin ',
        ' que ', ' como ', ' pero ', ' porque ', ' entonces ', ' ahora ',
        ' hola', ' gracias', ' por favor', ' necesito', ' quiero', ' puedes',
      ].reduce((acc, w) => acc + (t.includes(w) ? 1 : 0), 0);

      const enHits = [
        ' the ', ' a ', ' an ', ' and ', ' or ', ' but ', ' because ', ' so ',
        ' hello', ' thanks', ' please', ' i need', ' i want', ' can you',
      ].reduce((acc, w) => acc + (t.includes(w) ? 1 : 0), 0);

      if (esHits >= 3 && esHits > enHits) return 'es';
      if (enHits >= 2 && enHits >= esHits) return 'en';
      // Extra hint: Spanish punctuation
      if (/[¿¡]/.test(text)) return 'es';
      return 'unknown';
    };

    const shouldRetryEnglish = (requested: string, transcription: string) => {
      if (wakeWordOnly) return false;
      if (requested !== 'en') return false;
      const detected = detectLikelyLanguage(transcription);
      return detected === 'es';
    };

    console.log('[LeelooApi] voice.stt.start', {
      traceId,
      bytes: audioBuffer.length,
      language,
      hasEndpoint: Boolean(endpoint),
      endpoint,
      hasOpenAI: Boolean(this.openai),
      preferOpenAI,
      fallbackOnEmpty,
      wake_word_only: wakeWordOnly,
      stt_wake_timeout_ms: wakeWordOnly ? sttWakeTimeoutMs : null,
    });

    // FAST PATH: Prefer OpenAI Whisper when configured.
    // This avoids very slow self-hosted STT deployments (often 30-45s+ on free tiers).
    if (preferOpenAI && this.openai) {
      try {
        const model = this.configService.get<string>('OPENAI_WHISPER_MODEL') || 'whisper-1';
        const file = await toFile(audioBuffer, 'audio.m4a', {
          type: 'audio/m4a',
        });

        const res = await this.openai.audio.transcriptions.create({
          file,
          model,
          language,
        });

        const text = (res as any)?.text;
        const out = typeof text === 'string' ? text.trim() : '';
        console.log('[LeelooApi] voice.stt.openai.ok', {
          traceId,
          model,
          total_ms: Date.now() - startedAt,
          hasText: Boolean(out),
        });

        if (out) {
          const detected = detectLikelyLanguage(out);
          console.log('[LeelooApi] voice.stt.language', {
            traceId,
            requested: language,
            detected,
            wake_word_only: wakeWordOnly,
          });

          if (shouldRetryEnglish(language, out)) {
            try {
              console.warn('[LeelooApi] voice.stt.retry_language_mismatch', {
                traceId,
                requested: language,
                detected,
              });

              const res2 = await this.openai.audio.transcriptions.create({
                file,
                model,
                language: 'en',
              });
              const text2 = (res2 as any)?.text;
              const out2 = typeof text2 === 'string' ? text2.trim() : '';
              const detected2 = detectLikelyLanguage(out2);
              console.log('[LeelooApi] voice.stt.retry_language_mismatch.ok', {
                traceId,
                requested: 'en',
                detected: detected2,
                hasText: Boolean(out2),
                total_ms: Date.now() - startedAt,
              });
              if (out2) return out2;
            } catch (err2) {
              console.warn('[LeelooApi] voice.stt.retry_language_mismatch.fail', {
                traceId,
                ...this.axiosErrorSummary(err2),
              });
            }
          }

          return out;
        }

        // Premium UX: if Whisper returns empty (often silence/very short), do NOT fall back
        // to slow STT services unless explicitly enabled.
        if (!fallbackOnEmpty) {
          console.warn('[LeelooApi] voice.stt.openai.empty', {
            traceId,
            model,
            total_ms: Date.now() - startedAt,
          });
          return '';
        }
      } catch (err) {
        console.error('[LeelooApi] voice.stt.openai.error', {
          traceId,
          ...this.axiosErrorSummary(err),
          total_ms: Date.now() - startedAt,
        });
      }
    }

    if (endpoint) {
      try {
        const base = endpoint.replace(/\/+$/, '');

        // Some hosted STT services expose endpoints under a different base path.
        // We keep this simple: try the two most common routes.

        // Try OpenAI-style Whisper endpoint first: POST /v1/transcribe (multipart, field "file")
        try {
          const url = `${base}/v1/transcribe`;
          const t0 = Date.now();
          console.log('[LeelooApi] voice.stt.try', { traceId, url });
          const form = new FormData();
          form.append('file', audioBuffer, {
            filename: 'audio.m4a',
            contentType: 'audio/m4a',
          });
          form.append('language', language);

          let res;
          try {
            res = await axios.post(url, form, {
              timeout: wakeWordOnly ? sttWakeTimeoutMs : 120000,
              headers: {
                ...form.getHeaders(),
              },
              maxBodyLength: Infinity,
              maxContentLength: Infinity,
            });
          } catch (err) {
            if (isRateLimited(err)) {
              console.warn('[LeelooApi] voice.stt.rate_limited', {
                traceId,
                stt_url: url,
                ...this.axiosErrorSummary(err),
              });
              if (wakeWordOnly) return '';
              await sleep(900);
              try {
                res = await axios.post(url, form, {
                  timeout: wakeWordOnly ? sttWakeTimeoutMs : 120000,
                  headers: {
                    ...form.getHeaders(),
                  },
                  maxBodyLength: Infinity,
                  maxContentLength: Infinity,
                });
              } catch (err2) {
                console.warn('[LeelooApi] voice.stt.rate_limited.retry_failed', {
                  traceId,
                  stt_url: url,
                  ...this.axiosErrorSummary(err2),
                });
                return '';
              }
            } else {
              throw err;
            }
          }

          const text = res.data?.text;
          const out = typeof text === 'string' ? text.trim() : '';
          console.log('[LeelooApi] voice.stt.ok', {
            traceId,
            url,
            status: res.status,
            ms: Date.now() - t0,
            hasText: Boolean(out),
          });
          if (out) return out;
        } catch (err) {
          console.warn('[LeelooApi] voice.stt.fail', {
            traceId,
            ...this.axiosErrorSummary(err),
          });
          if (isRateLimited(err)) {
            return '';
          }
          if (wakeWordOnly) {
            // Wake-word loop must never pay extra latency for alternate routes.
            return '';
          }
          // Do NOT fall through to /asr. Our deployed STT is /v1/transcribe and /transcribe.
          // Falling through causes slow 404s and destabilizes voice loops.
        }

        // Try common FastAPI wrappers: POST /transcribe (multipart, field "file")
        // (Many deployments keep / as 404 but expose /docs and /openapi.json)
        {
          const url2 = `${base}/transcribe`;
          const t0 = Date.now();
          console.log('[LeelooApi] voice.stt.try', { traceId, url: url2 });
          const form2 = new FormData();
          form2.append('file', audioBuffer, {
            filename: 'audio.m4a',
            contentType: 'audio/m4a',
          });
          form2.append('language', language);

          let res2;
          try {
            res2 = await axios.post(url2, form2, {
              timeout: wakeWordOnly ? sttWakeTimeoutMs : 120000,
              headers: {
                ...form2.getHeaders(),
              },
              maxBodyLength: Infinity,
              maxContentLength: Infinity,
            });
          } catch (err) {
            if (isRateLimited(err)) {
              console.warn('[LeelooApi] voice.stt.rate_limited', {
                traceId,
                stt_url: url2,
                ...this.axiosErrorSummary(err),
              });
              return '';
            }
            throw err;
          }

          const text2 = res2.data?.text;
          const out2 = typeof text2 === 'string' ? text2.trim() : '';
          console.log('[LeelooApi] voice.stt.ok', {
            traceId,
            url: url2,
            status: res2.status,
            ms: Date.now() - t0,
            hasText: Boolean(out2),
          });
          if (out2) return out2;
        }
      } catch (err) {
        console.error('[LeelooApi] voice.stt.error', {
          traceId,
          ...this.axiosErrorSummary(err),
          total_ms: Date.now() - startedAt,
        });

        if (isRateLimited(err)) {
          return '';
        }

        // If external STT fails, fall back to OpenAI Whisper if available
      }
    } else {
      console.error('[LeelooApi] voice.stt.no_endpoint', { traceId });
    }

    // Fallback explícito: solo si hay OPENAI_API_KEY configurada.
    if (!this.openai) {
      return '';
    }

    try {
      const model = this.configService.get<string>('OPENAI_WHISPER_MODEL') || 'whisper-1';
      const file = await toFile(audioBuffer, 'audio.m4a', {
        type: 'audio/m4a',
      });

      const res = await this.openai.audio.transcriptions.create({
        file,
        model,
        language,
      });

      const text = (res as any)?.text;
      const out = typeof text === 'string' ? text.trim() : '';
      console.log('[LeelooApi] voice.stt.openai.ok', {
        traceId,
        model,
        total_ms: Date.now() - startedAt,
        hasText: Boolean(out),
      });
      return out;
    } catch (err) {
      console.error('[LeelooApi] voice.stt.openai.error', {
        traceId,
        status: (err as any)?.status,
        error: (err as any)?.error || String(err),
        total_ms: Date.now() - startedAt,
      });
      return '';
    } finally {
      console.log('[LeelooApi] voice.stt.end', {
        traceId,
        total_ms: Date.now() - startedAt,
      });
    }
  }

  async processIntent(
    clerkUserId: string,
    text?: string,
    userContext?: { language?: string; faith_mode?: boolean; role?: string; channel?: 'VOICE' | 'TEXT'; role_policy?: any },
  ) {
    const t0 = Date.now();
    const requestId = (userContext as any)?.request_id || null;
    const wakeWordOnly = Boolean((userContext as any)?.wake_word_only);
    const sttMs = typeof (userContext as any)?.stt_ms === 'number' ? Number((userContext as any).stt_ms) : null;
    const llmIntentMs: { v: number | null } = { v: null };
    const llmResponseMs: { v: number | null } = { v: null };

    const hasChatLlmConfigured = Boolean(
      (this.configService.get<string>('LLM_CHAT_MODEL') ||
        this.configService.get<string>('LLM_MODEL') ||
        this.configService.get<string>('LOCAL_LLM_MODEL')) &&
        (this.configService.get<string>('LLAMA_BASE_URL') ||
          this.configService.get<string>('LLM_ENDPOINT') ||
          this.configService.get<string>('LOCAL_LLM_ENDPOINT')),
    );

    const emitMetrics = (intentObj: any, opts?: { fallback_used?: boolean; intent_source?: string | null }) => {
      try {
        const intentName = String((intentObj as any)?.intent || '');
        const intentSource =
          typeof opts?.intent_source === 'string'
            ? opts.intent_source
            : String((intentObj as any)?.intent_source || '') || null;
        const coreMatched = this.isCoreIntent(intentName);
        const fallbackUsed =
          typeof opts?.fallback_used === 'boolean' ? opts.fallback_used : intentSource === 'fallback';
        const totalMs = Date.now() - t0;
        const routerMs = totalMs - (sttMs || 0);
        this.logVoiceMetrics({
          request_id: requestId,
          user_id: clerkUserId,
          channel,
          wake_word_only: wakeWordOnly,
          intent: intentName,
          intent_source: intentSource,
          core_intent_matched: coreMatched,
          fallback_used: fallbackUsed,
          router_ms: Math.max(0, Math.floor(routerMs)),
          stt_ms: sttMs !== null ? Math.floor(sttMs) : null,
          llm_intent_ms: llmIntentMs.v !== null ? Math.floor(llmIntentMs.v) : null,
          llm_response_ms:
            hasChatLlmConfigured && llmResponseMs.v !== null ? Math.floor(llmResponseMs.v) : null,
          total_ms: Math.floor(totalMs),
        });
      } catch {
        // ignore
      }
    };

    const channel: 'VOICE' | 'TEXT' = (userContext as any)?.channel === 'TEXT' ? 'TEXT' : 'VOICE';
    const normalizer = new InputNormalizer();
    const supervisor = new ExecutiveSupervisor();
    const factIngestor = new FactIngestor();
    const input = normalizer.normalize(text || '');
    const cleanedText = input.cleaned;

    // Resolve persisted user state (language + pending intent/slots).
    const profile =
      (await this.profilesService.getProfileByClerkUserId(clerkUserId)) ||
      (await this.profilesService.ensureProfileByClerkUserId(clerkUserId));
    const state = this.profilesService.getConversationState(profile);

    const conversationMode: 'conversation' | 'action' =
      (state?.mode === 'action' || state?.mode === 'conversation')
        ? state.mode
        : 'conversation';

    const isCancel = (raw: string) => normalizer.decisionToken(raw) === 'CANCEL';
    const isConfirm = (raw: string) => normalizer.decisionToken(raw) === 'YES';

    const buildConfirmQuestion = (intentName: string, language: SupportedLanguage): string => {
      const i = String(intentName || '');
      if (i === 'send_email') {
        return language === 'es'
          ? 'Perfecto. ¿Quieres que lo envíe ahora?'
          : 'Perfect. Do you want me to send it now?';
      }
      if (i === 'create_task') {
        return language === 'es'
          ? 'Listo. ¿Quieres que la cree ahora?'
          : 'Got it. Do you want me to create it now?';
      }
      if (i === 'reminder') {
        return language === 'es'
          ? 'Ok. ¿Lo confirmas y lo dejo creado?'
          : 'Okay. Can you confirm and I’ll create it?';
      }
      if (i === 'schedule_meeting') {
        return language === 'es'
          ? 'Ok. ¿Lo agrego al calendario?'
          : 'Okay. Should I add it to your calendar?';
      }
      if (i === 'delete_event') {
        return language === 'es'
          ? 'Ok. ¿Quieres que lo elimine ahora?'
          : 'Okay. Do you want me to delete it now?';
      }
      if (i === 'update_event_time') {
        return language === 'es'
          ? 'Ok. ¿Quieres que lo cambie ahora?'
          : 'Okay. Do you want me to change it now?';
      }
      return language === 'es'
        ? 'Ok. ¿Quieres que lo haga ahora?'
        : 'Okay. Do you want me to do it now?';
    };

    let language =
      (this.profilesService.getPreferredLanguage(profile) ||
        ((userContext?.language || 'en').toLowerCase() as any) ||
        'en') as SupportedLanguage;

    const persistTurn = async (assistantText: string, meta?: any) => {
      try {
        await this.memoriesService.appendTurn(clerkUserId, {
          user: cleanedText,
          assistant: assistantText,
          language,
          meta,
        });

        const existing = await this.memoriesService.getMemoryByKey(clerkUserId, 'session_summary');
        const prev = (existing?.value && typeof existing.value === 'object') ? String(existing.value.summary || '') : '';
        const addition = `User: ${cleanedText}\nAssistant: ${assistantText}`;
        const next = prev ? `${prev}\n\n${addition}` : addition;
        const trimmed = next.length > 2400 ? next.slice(next.length - 2400) : next;
        await this.memoriesService.setSessionSummary(clerkUserId, {
          assistant_name: 'Leeloo',
          language,
          summary: trimmed,
        });
      } catch {
        // best-effort
      }
    };

    const namespacesForIntent = () => {
      // Minimal, deterministic context for intent extraction.
      return ['identity', 'preferences'];
    };

    const namespacesForResponse = (intentName: string) => {
      const i = String(intentName || '');
      if (i === 'send_email') return ['identity', 'preferences', 'relationships'];
      if (i === 'create_task' || i === 'reminder') return ['identity', 'preferences'];
      if (i === 'daily_planning') return ['identity', 'preferences', 'household'];
      if (i === 'emotional_expression' || i === 'emotional_support') return ['identity', 'preferences', 'relationships'];
      return ['identity', 'preferences'];
    };

    const memoryGate = async (namespaces: string[]) => {
      const sessionSummary = await this.memoriesService.getSessionSummary(clerkUserId);
      const recentTurns = await this.memoriesService.getRecentConversationTurns(clerkUserId, 6);

      const turnsContext = recentTurns
        .reverse()
        .map((m: any) => {
          const v = m?.value;
          const u = v?.user ? String(v.user) : '';
          const a = v?.assistant ? String(v.assistant) : '';
          return u && a ? `User: ${u}\nAssistant: ${a}` : '';
        })
        .filter(Boolean)
        .join('\n\n');

      const facts = await this.memoriesService.getFacts(clerkUserId, namespaces, 40);
      const factsContext = (facts || [])
        .map((m: any) => {
          const k = String(m?.key || '');
          const v = m?.value;
          return k ? `${k}: ${JSON.stringify(v)}` : '';
        })
        .filter(Boolean)
        .join('\n');

      const context = [
        `AUTHORITATIVE IDENTITY (NON-NEGOTIABLE):\n- assistant_name: Leeloo\n- language_lock: ${language}\n`,
        sessionSummary ? `SESSION SUMMARY (authoritative):\n${sessionSummary}` : null,
        factsContext ? `LONG-TERM FACTS (authoritative):\n${factsContext}` : null,
        turnsContext ? `RECENT TURNS:\n${turnsContext}` : null,
      ]
        .filter(Boolean)
        .join('\n\n');

      console.log('[LeelooApi] memory.gate', {
        userId: clerkUserId,
        has_session_summary: Boolean(sessionSummary),
        facts_count: Array.isArray(facts) ? facts.length : 0,
        turns_count: Array.isArray(recentTurns) ? recentTurns.length : 0,
        namespaces,
      });

      return { context, facts, sessionSummary };
    };

    const buildExecutedResponse = (intentName: string, actionResult: any, language: SupportedLanguage) => {
      const i = String(intentName || '');
      if (i === 'send_email') {
        const meta = (actionResult as any)?.metadata || {};
        const status = String(meta?.status || '').toLowerCase();
        const to = String((actionResult as any)?.to || meta?.to || '').trim();
        if (status === 'sent') {
          return language === 'es'
            ? `Listo. Ya envié el correo${to ? ` a ${to}` : ''}.`
            : `Done. I sent the email${to ? ` to ${to}` : ''}.`;
        }
        return language === 'es'
          ? 'Intenté enviar el correo, pero falló. ¿Quieres que lo intentemos otra vez?'
          : 'I tried to send the email, but it failed. Want to try again?';
      }
      if (i === 'create_task') {
        const title = String((actionResult as any)?.title || (actionResult as any)?.name || '').trim();
        return language === 'es'
          ? `Listo. Creé la tarea${title ? `: "${title}"` : ''}.`
          : `Done. I created the task${title ? `: "${title}"` : ''}.`;
      }
      if (i === 'reminder') {
        return language === 'es'
          ? 'Listo. Ya quedó creado.'
          : 'Done. It’s created.';
      }

      if (i === 'delete_event') {
        const title = String((actionResult as any)?.title || '').trim();
        return language === 'es'
          ? `Listo. Eliminé el evento${title ? `: "${title}"` : ''}.`
          : `Done. I deleted the event${title ? `: "${title}"` : ''}.`;
      }

      if (i === 'update_event_time') {
        const title = String((actionResult as any)?.title || '').trim();
        return language === 'es'
          ? `Listo. Actualicé el evento${title ? `: "${title}"` : ''}.`
          : `Done. I updated the event${title ? `: "${title}"` : ''}.`;
      }

      return language === 'es'
        ? 'Listo.'
        : 'Done.';
    };

    const getFactValue = (rows: any[], namespace: string, key: string) => {
      const ns = String(namespace || '').toLowerCase();
      const k = String(key || '').toLowerCase();
      for (const r of rows || []) {
        const v = r?.value;
        const rNs = String(v?.namespace || '').toLowerCase();
        const rKey = String(v?.key || '').toLowerCase();
        if (rNs === ns && rKey === k) return v?.value;
      }
      return null;
    };

    const parseMinutes = (raw: string): number | null => {
      const s = String(raw || '').toLowerCase();
      const m1 = s.match(/\b(\d{1,3})\s*(min|mins|minutes|minutos)\b/);
      if (m1 && m1[1]) {
        const n = Number(m1[1]);
        return Number.isFinite(n) && n > 0 ? n : null;
      }
      const m2 = s.match(/\b(\d{1,2})\s*h\b/);
      if (m2 && m2[1]) {
        const n = Number(m2[1]);
        const mins = n * 60;
        return Number.isFinite(mins) && mins > 0 ? mins : null;
      }
      if (s.includes('quick') || s.includes('rapido') || s.includes('rápido')) return 15;
      if (s.includes('half an hour') || s.includes('media hora')) return 30;
      return null;
    };

    const mealPlanningTrigger = (rawLower: string) => {
      const t = String(rawLower || '');
      return (
        /\b(what\s+should\s+i\s+cook|what\s+can\s+i\s+cook|what\s+to\s+cook|dinner\s+ideas|lunch\s+ideas|meal\s+ideas)\b/.test(t) ||
        /\b(no\s+se\s+que\s+hacer\s+de\s+comer|no\s+sé\s+qué\s+hacer\s+de\s+comer|que\s+cocino|qué\s+cocino|ideas\s+de\s+comida|ideas\s+para\s+cenar|ideas\s+para\s+almorzar)\b/.test(t)
      );
    };

    const buildMealOptions = (params: {
      items: string[];
      minutes: number;
      diet?: string | null;
      dislikes?: string[] | null;
      language: SupportedLanguage;
    }) => {
      const items = (params.items || []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
      const minutes = params.minutes;
      const diet = String(params.diet || '').toLowerCase();
      const dislikes = (params.dislikes || []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);

      const has = (w: string) => items.some((i) => i.includes(w));
      const hasAny = (ws: string[]) => ws.some((w) => has(w));
      const disliked = (w: string) => dislikes.some((d) => d.includes(w));

      const eggs = hasAny(['egg', 'eggs', 'huevo', 'huevos']);
      const rice = hasAny(['rice', 'arroz']);
      const chicken = hasAny(['chicken', 'pollo']);
      const pasta = hasAny(['pasta', 'spaghetti', 'macaroni']);
      const tuna = hasAny(['tuna', 'atun', 'atún']);
      const veggies = hasAny(['tomato', 'tomatoes', 'onion', 'garlic', 'pepper', 'spinach', 'broccoli', 'zanahoria', 'tomate', 'cebolla', 'ajo', 'pimiento', 'espinaca', 'brocoli', 'brócoli']);

      const options: { title: string; why: string; steps: string }[] = [];

      const push = (o: { title: string; why: string; steps: string }) => {
        if (options.length >= 4) return;
        if (options.some((x) => x.title === o.title)) return;
        options.push(o);
      };

      const isVeg = diet === 'vegetarian';

      if (minutes <= 15) {
        if (eggs && veggies && !disliked('egg')) {
          push({
            title: params.language === 'es' ? 'Veggie omelet' : 'Veggie omelet',
            why: params.language === 'es' ? 'Rápido y usa lo que ya tienes.' : 'Fast and uses what you already have.',
            steps: params.language === 'es'
              ? 'Saltea verduras 3–4 min, agrega huevos batidos, cuaja y listo.'
              : 'Sauté veggies 3–4 min, add beaten eggs, set, done.',
          });
        }
        if (tuna && pasta && !disliked('tuna')) {
          push({
            title: params.language === 'es' ? 'Pasta rápida con atún' : 'Quick tuna pasta',
            why: params.language === 'es' ? '15 min, simple y con proteína.' : '15 min, simple, protein-friendly.',
            steps: params.language === 'es'
              ? 'Hierve pasta, mezcla con atún y un toque de aceite/ajo si hay.'
              : 'Boil pasta, mix in tuna and a bit of oil/garlic if you have it.',
          });
        }
      }

      if (minutes <= 30) {
        if (rice && eggs && veggies && !disliked('egg')) {
          push({
            title: params.language === 'es' ? 'Arroz frito simple' : 'Simple fried rice',
            why: params.language === 'es' ? 'Rinde y aprovecha sobras.' : 'Filling and great for leftovers.',
            steps: params.language === 'es'
              ? 'Saltea verduras, agrega arroz y luego huevo. Sazona y listo.'
              : 'Sauté veggies, add rice, then egg. Season and done.',
          });
        }

        if (!isVeg && chicken && rice && !disliked('chicken')) {
          push({
            title: params.language === 'es' ? 'Pollo salteado con arroz' : 'Chicken stir-fry with rice',
            why: params.language === 'es' ? 'Balanceado y fácil.' : 'Balanced and easy.',
            steps: params.language === 'es'
              ? 'Dora pollo, agrega verduras si hay, sirve sobre arroz.'
              : 'Brown chicken, add veggies if you have them, serve over rice.',
          });
        }

        if (pasta && veggies) {
          push({
            title: params.language === 'es' ? 'Pasta con verduras' : 'Veggie pasta',
            why: params.language === 'es' ? 'Flexible con lo que haya.' : 'Flexible with whatever you have.',
            steps: params.language === 'es'
              ? 'Hierve pasta, saltea verduras, mezcla y ajusta sal/pimienta.'
              : 'Boil pasta, sauté veggies, toss, adjust salt/pepper.',
          });
        }
      }

      if (options.length === 0) {
        push({
          title: params.language === 'es' ? 'Bowl simple' : 'Simple bowl',
          why: params.language === 'es' ? 'No requiere receta: arma con lo que tengas.' : 'No recipe needed—assemble from what you have.',
          steps: params.language === 'es'
            ? 'Elige base (arroz/pasta), agrega proteína si hay y verduras. Sazona.'
            : 'Pick a base (rice/pasta), add protein if you have it and veggies. Season.',
        });
      }

      return options.slice(0, 4);
    };

    // Make sure mode is persisted at least once so production debugging is consistent.
    if (!state?.mode) {
      try {
        await this.profilesService.setConversationState(clerkUserId, {
          preferred_language: language,
          mode: conversationMode,
          system_on: state?.system_on,
        });
      } catch {
        // best effort
      }
    }

    const systemOn = channel === 'TEXT' ? true : this.profilesService.getSystemOn(profile);

    // EXECUTIVE ROUTER (HARD GATE): when awaiting confirmation, do NOT call LLM or re-run intent detection.
    // We only accept YES/NO/CANCEL deterministically and execute/cancel the already-persisted pending intent.
    if ((state as any)?.intent_state === 'AWAITING_CONFIRMATION') {
      const pendingIntent = (state as any)?.pending_intent || null;
      const pendingSlots = (state as any)?.pending_slots || {};
      const pendingName = String(pendingIntent?.intent || '');
      const token = input.decision_token;

      console.log('[LeelooApi] executive.router.confirmation_gate', {
        userId: clerkUserId,
        intent_state_in: (state as any)?.intent_state || null,
        token,
        pending_intent: pendingName || null,
      });

      if (!pendingIntent || !pendingName) {
        await this.profilesService.setConversationState(clerkUserId, {
          preferred_language: language,
          assistant_name: 'Leeloo',
          intent_state: 'NONE',
          pending_intent: null,
          pending_slots: null,
          missing_slots: [],
          next_question: undefined,
          last_question: undefined,
          last_intent: 'query',
          last_action: undefined,
        } as any);

        const responseText = language === 'es'
          ? 'Ok. ¿Qué quieres hacer ahora?'
          : 'Okay. What do you want to do now?';
        const audioUrl = await this.generateTTS(responseText, language);
        await persistTurn(responseText, { executive_router: true, reason: 'awaiting_confirmation_without_pending_intent' });
        emitMetrics({ intent: 'query', intent_source: 'deterministic' }, { intent_source: 'deterministic', fallback_used: false });
        return {
          transcription: cleanedText,
          intent: { intent: 'query', confidence: 1, decision: 'COACH', original_text: cleanedText } as any,
          action_result: null,
          response_text: responseText,
          response_audio_url: audioUrl,
        };
      }

      if (token === 'CANCEL' || token === 'NO') {
        await this.profilesService.setConversationState(clerkUserId, {
          preferred_language: language,
          assistant_name: 'Leeloo',
          current_goal: undefined,
          intent_state: 'NONE',
          pending_intent: null,
          pending_slots: null,
          missing_slots: [],
          next_question: undefined,
          last_question: undefined,
          last_intent: pendingName,
          last_action: undefined,
        } as any);

        const responseText = language === 'es'
          ? 'Listo. No lo hago. ¿Qué quieres hacer ahora?'
          : "Okay. I won't do it. What do you want to do now?";
        const audioUrl = await this.generateTTS(responseText, language);
        await persistTurn(responseText, { executive_router: true, intent: pendingName, token, canceled: true });
        emitMetrics({ intent: 'cancel', intent_source: 'deterministic' }, { intent_source: 'deterministic', fallback_used: false });
        return {
          transcription: cleanedText,
          intent: { intent: 'cancel', confidence: 1, decision: 'COACH', original_text: cleanedText } as any,
          action_result: null,
          response_text: responseText,
          response_audio_url: audioUrl,
        };
      }

      if (token === 'YES') {
        // Mark EXECUTING before executing, then DONE.
        await this.profilesService.setConversationState(clerkUserId, {
          preferred_language: language,
          assistant_name: 'Leeloo',
          current_goal: pendingName,
          intent_state: 'EXECUTING',
          pending_intent: pendingIntent,
          pending_slots: pendingSlots,
          missing_slots: [],
          next_question: undefined,
          last_question: undefined,
          last_intent: pendingName,
        } as any);

        const actionResult = await this.executeIntent(clerkUserId, pendingIntent, language);
        const responseText = buildExecutedResponse(pendingName, actionResult, language);
        const audioUrl = await this.generateTTS(responseText, language);
        await persistTurn(responseText, { executive_router: true, intent: pendingName, token, executed: true });

        await this.profilesService.setConversationState(clerkUserId, {
          preferred_language: language,
          assistant_name: 'Leeloo',
          current_goal: undefined,
          intent_state: 'DONE',
          pending_intent: null,
          pending_slots: null,
          missing_slots: [],
          next_question: undefined,
          last_question: undefined,
          last_action: pendingName,
          last_intent: pendingName,
        } as any);

        return {
          transcription: cleanedText,
          intent: { ...pendingIntent, confidence: 1, decision: 'ACTION', original_text: cleanedText } as any,
          action_result: actionResult,
          task_id: (actionResult as any)?.id || null,
          response_text: responseText,
          response_audio_url: audioUrl,
        };
      }

      const confirmQ = buildConfirmQuestion(pendingName, language);
      const responseText = language === 'es'
        ? `${confirmQ} (Responde “sí” o “no”.)`
        : `${confirmQ} (Answer “yes” or “no”.)`;
      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { executive_router: true, intent: pendingName, token, awaiting_confirmation: true });
      emitMetrics({ intent: pendingName, intent_source: 'deterministic' }, { intent_source: 'deterministic', fallback_used: false });
      await this.profilesService.setConversationState(clerkUserId, {
        preferred_language: language,
        assistant_name: 'Leeloo',
        current_goal: pendingName,
        intent_state: 'AWAITING_CONFIRMATION',
        pending_intent: pendingIntent,
        pending_slots: pendingSlots,
        missing_slots: [],
        next_question: responseText,
        last_question: responseText,
        last_intent: pendingName,
      } as any);
      return {
        transcription: cleanedText,
        intent: { intent: 'awaiting_confirmation', confidence: 1, decision: 'QUESTION', original_text: cleanedText } as any,
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    const execDecision = supervisor.decide({
      input,
      state,
      language,
      system_on: systemOn,
    });

    console.log('[LeelooApi] executive.supervisor', {
      userId: clerkUserId,
      intent_state_in: state?.intent_state || null,
      decision: execDecision.kind,
      token: (execDecision as any)?.token || null,
    });

    if (execDecision.kind === 'HANDLE_CONFIRMATION') {
      console.log('[LeelooApi] confirmation.input', {
        userId: clerkUserId,
        cleaned: input.cleaned,
        normalized: input.normalized,
        decision_token: input.decision_token,
        pending_intent: state?.pending_intent?.intent || null,
        intent_state_in: state?.intent_state || null,
      });
    }

    if (execDecision.kind === 'SYSTEM_WAKE') {
      await this.profilesService.setConversationState(clerkUserId, {
        preferred_language: language,
        system_on: true,
        intent_state: 'NONE',
        pending_intent: null,
        pending_slots: null,
        missing_slots: [],
        next_question: undefined,
        current_goal: undefined,
      });

      const displayName =
        typeof (profile as any)?.preferences?.user_identity?.display_name === 'string'
          ? String((profile as any).preferences.user_identity.display_name).trim()
          : '';

      const namePart = displayName ? ` ${displayName}` : '';

      const variantsEn = [
        `Hey${namePart}. I'm here. What do you need?`,
        `Hi${namePart}. I'm ready. What's up?`,
        `Alright${namePart}. I'm listening.`,
      ];

      const variantsEs = [
        `Hola${namePart}. Estoy aquí. ¿Qué necesitas?`,
        `Hey${namePart}. Lista. ¿Qué hacemos?`,
        `Dime${namePart}. Te escucho.`,
      ];

      const pick = (arr: string[]) => arr[Math.abs(Date.now()) % arr.length];
      const responseText = language === 'es' ? pick(variantsEs) : pick(variantsEn);

      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { system: 'wake', has_name: Boolean(displayName) });
      emitMetrics({ intent: 'system_on', intent_source: 'deterministic' }, { intent_source: 'deterministic', fallback_used: false });
      return {
        transcription: cleanedText,
        intent: { intent: 'system_on', confidence: 1 },
        action_result: { system_on: true },
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    if (execDecision.kind === 'SYSTEM_SLEEP') {
      await this.profilesService.setConversationState(clerkUserId, {
        preferred_language: language,
        system_on: false,
        intent_state: 'NONE',
        pending_intent: null,
        pending_slots: null,
        missing_slots: [],
        next_question: undefined,
        last_question: undefined,
        current_goal: undefined,
      });

      const displayName =
        typeof (profile as any)?.preferences?.user_identity?.display_name === 'string'
          ? String((profile as any).preferences.user_identity.display_name).trim()
          : '';
      const namePart = displayName ? ` ${displayName}` : '';

      const variantsEn = [
        `Okay${namePart}. Going quiet. When you need me, say “Leeloo wake up”.`,
        `All set${namePart}. I’ll be here when you need me. Say “Leeloo wake up”.`,
        `Got it${namePart}. Talk soon. Say “Leeloo wake up” when you’re ready.`,
      ];
      const variantsEs = [
        `Listo${namePart}. Me quedo en silencio. Cuando me necesites, di “Leeloo despierta”.`,
        `Hecho${namePart}. Aquí estaré. Cuando me necesites, di “Leeloo despierta”.`,
        `Perfecto${namePart}. Hasta la próxima. Di “Leeloo despierta” cuando quieras.`,
      ];

      const pick = (arr: string[]) => arr[Math.abs(Date.now()) % arr.length];
      const responseText = language === 'es' ? pick(variantsEs) : pick(variantsEn);
      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { system: 'sleep' });
      emitMetrics({ intent: 'system_off', intent_source: 'deterministic' }, { intent_source: 'deterministic', fallback_used: false });
      return {
        transcription: cleanedText,
        intent: { intent: 'system_off', confidence: 1 },
        action_result: { system_on: false },
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    if (execDecision.kind === 'SYSTEM_OFF_BLOCK') {
      const responseText = language === 'es'
        ? 'Estoy en silencio. Si quieres que vuelva, di “Leeloo despierta”.'
        : 'I’m quiet right now. If you want me back, say “Leeloo wake up”.';
      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { system: 'off' });
      emitMetrics({ intent: 'system_off', intent_source: 'deterministic' }, { intent_source: 'deterministic', fallback_used: false });
      return {
        transcription: cleanedText,
        intent: { intent: 'system_off', confidence: 1 },
        action_result: { system_on: false },
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    if (execDecision.kind === 'BLOCK_EXECUTING') {
      const responseText = language === 'es'
        ? 'Dame un segundo: estoy terminando algo. ¿Quieres que lo cancele?' 
        : "Give me a second—I’m finishing something. Do you want me to cancel it?";
      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { executive_block: 'EXECUTING' });
      emitMetrics({ intent: 'executing', intent_source: 'deterministic' }, { intent_source: 'deterministic', fallback_used: false });
      return {
        transcription: cleanedText,
        intent: { intent: 'executing', confidence: 1, decision: 'QUESTION', original_text: cleanedText } as any,
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    if (execDecision.kind === 'HANDLE_CONFIRMATION') {
      const pendingIntent = state?.pending_intent || null;
      const pendingSlots = state?.pending_slots || {};
      const pendingName = String(pendingIntent?.intent || '');

      const fromState = state?.intent_state || null;

      if (!pendingIntent || !pendingName) {
        console.log('[LeelooApi] intent_state.transition', {
          userId: clerkUserId,
          from: fromState,
          to: 'NONE',
          reason: 'confirm_without_pending_intent',
        });
        await this.profilesService.setConversationState(clerkUserId, {
          preferred_language: language,
          assistant_name: 'Leeloo',
          intent_state: 'NONE',
          pending_intent: null,
          pending_slots: null,
          missing_slots: [],
          next_question: undefined,
          last_question: undefined,
          last_intent: 'query',
          last_action: undefined,
        } as any);
        const responseText = language === 'es'
          ? 'Ok. ¿Qué quieres hacer ahora?'
          : 'Okay. What do you want to do now?';
        const audioUrl = await this.generateTTS(responseText, language);
        await persistTurn(responseText, { executive_router: true, reason: 'no_pending_intent' });
        return {
          transcription: cleanedText,
          intent: { intent: 'query', confidence: 1, decision: 'COACH', original_text: cleanedText } as any,
          action_result: null,
          response_text: responseText,
          response_audio_url: audioUrl,
        };
      }

      // Deterministic confirmation gate: NEVER call extractIntent here.
      const token = (execDecision as any)?.token;
      if (token === 'CANCEL' || token === 'NO') {
        console.log('[LeelooApi] intent_state.transition', {
          userId: clerkUserId,
          from: fromState,
          to: 'NONE',
          reason: token === 'CANCEL' ? 'cancel' : 'no',
          intent: pendingName,
        });
        await this.profilesService.setConversationState(clerkUserId, {
          preferred_language: language,
          assistant_name: 'Leeloo',
          current_goal: undefined,
          intent_state: 'NONE',
          pending_intent: null,
          pending_slots: null,
          missing_slots: [],
          next_question: undefined,
          last_question: undefined,
          last_intent: pendingName,
        } as any);
        const responseText = language === 'es'
          ? 'Listo. No lo hago. ¿Qué quieres hacer ahora?'
          : "Okay. I won't do it. What do you want to do now?";
        const audioUrl = await this.generateTTS(responseText, language);
        await persistTurn(responseText, { intent: pendingName, cancel: true });
        return {
          transcription: cleanedText,
          intent: { intent: 'cancel', confidence: 1, decision: 'COACH', original_text: cleanedText } as any,
          action_result: null,
          response_text: responseText,
          response_audio_url: audioUrl,
        };
      }

      if (token === 'YES') {
        console.log('[LeelooApi] intent_state.transition', {
          userId: clerkUserId,
          from: fromState,
          to: 'EXECUTING',
          reason: 'confirmed',
          intent: pendingName,
        });
        await this.profilesService.setConversationState(clerkUserId, {
          preferred_language: language,
          assistant_name: 'Leeloo',
          current_goal: pendingName,
          intent_state: 'EXECUTING',
          pending_intent: pendingIntent,
          pending_slots: pendingSlots,
          missing_slots: [],
          next_question: undefined,
          last_question: undefined,
          last_intent: pendingName,
        } as any);

        const actionResult = await this.executeIntent(clerkUserId, pendingIntent, language);
        const responseText = buildExecutedResponse(pendingName, actionResult, language);
        const audioUrl = await this.generateTTS(responseText, language);
        await persistTurn(responseText, { executive_router: true, intent: pendingName, token, executed: true });

        console.log('[LeelooApi] intent_state.transition', {
          userId: clerkUserId,
          from: 'EXECUTING',
          to: 'DONE',
          reason: 'executed',
          intent: pendingName,
        });
        await this.profilesService.setConversationState(clerkUserId, {
          preferred_language: language,
          assistant_name: 'Leeloo',
          current_goal: undefined,
          intent_state: 'DONE',
          pending_intent: null,
          pending_slots: null,
          missing_slots: [],
          next_question: undefined,
          last_question: undefined,
          last_action: pendingName,
          last_intent: pendingName,
        } as any);

        return {
          transcription: cleanedText,
          intent: { ...pendingIntent, confidence: 1, decision: 'ACTION', original_text: cleanedText } as any,
          action_result: actionResult,
          task_id: (actionResult as any)?.id || null,
          response_text: responseText,
          response_audio_url: audioUrl,
        };
      }

      // token OTHER: keep asking deterministically.
      const confirmQ = buildConfirmQuestion(pendingName, language);
      const responseText = language === 'es'
        ? `${confirmQ} (Responde “sí” o “no”.)`
        : `${confirmQ} (Answer “yes” or “no”.)`;
      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { executive_router: true, intent: pendingName, token, awaiting_confirmation: true });
      await this.profilesService.setConversationState(clerkUserId, {
        preferred_language: language,
        assistant_name: 'Leeloo',
        current_goal: pendingName,
        intent_state: 'AWAITING_CONFIRMATION',
        pending_intent: pendingIntent,
        pending_slots: pendingSlots,
        missing_slots: [],
        next_question: responseText,
        last_question: responseText,
        last_intent: pendingName,
      } as any);

      console.log('[LeelooApi] intent_state.transition', {
        userId: clerkUserId,
        from: fromState,
        to: 'AWAITING_CONFIRMATION',
        reason: 'token_other_reask',
        intent: pendingName,
      });

      console.log('[LeelooApi] confirmation.reask', {
        userId: clerkUserId,
        token,
        cleaned: input.cleaned,
        normalized: input.normalized,
        decision_token: input.decision_token,
        intent: pendingName,
      });

      return {
        transcription: cleanedText,
        intent: pendingIntent,
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    // ExecutiveBrain v2: if we have no usable text, avoid Qwen/Llama and respond deterministically.
    if (!cleanedText) {
      const responseText = this.buildSttFailureMessage(language);
      const audioUrl = await this.generateTTS(responseText, language);

      emitMetrics({ intent: 'stt_failed', intent_source: 'deterministic' }, { intent_source: 'deterministic', fallback_used: false });
      return {
        transcription: '',
        intent: null,
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    // ExecutiveBrain v2: deterministic slot fill while an intent is pending.
    // This avoids calling Qwen again (big latency) when the user is answering a missing slot question.
    if (state?.pending_intent && Array.isArray(state?.missing_slots) && state.missing_slots.length > 0) {
      const pendingIntent = state.pending_intent;
      const intentName = String(pendingIntent?.intent || '');
      const missing = (state.missing_slots as string[]).map((s: any) => String(s || '')).filter(Boolean);
      const firstMissing = missing[0] || '';
      const filled = (pendingIntent?.filled_slots && typeof pendingIntent.filled_slots === 'object')
        ? { ...(pendingIntent.filled_slots as any) }
        : {};

      let changed = false;

      if (intentName === 'send_email') {
        if (firstMissing === 'to') {
          const emailMatch = cleanedText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
          if (emailMatch && emailMatch[0]) {
            filled.to = emailMatch[0];
            changed = true;
          } else {
            filled.to = cleanedText.trim();
            changed = true;
          }
        }
        if (firstMissing === 'body') {
          filled.body = cleanedText.trim();
          changed = true;
        }
      }

      if (intentName === 'create_task') {
        if (firstMissing === 'title') {
          filled.title = cleanedText.trim();
          changed = true;
        }
      }

      if (intentName === 'delete_event') {
        if (firstMissing === 'title_query') {
          filled.title_query = cleanedText.trim();
          changed = true;
        }
      }

      if (intentName === 'update_event_time') {
        if (firstMissing === 'title_query') {
          filled.title_query = cleanedText.trim();
          changed = true;
        }
        if (firstMissing === 'start_at') {
          const normalized = String(cleanedText || '').trim();
          const parsed = this.inferDeterministicIntent(normalized, language)?.filled_slots?.start_at;
          filled.start_at = String(parsed || '').trim() || filled.start_at || '';
          if (String(filled.start_at || '').trim()) changed = true;
        }
      }

      if (intentName === 'reminder') {
        if (firstMissing === 'activity') {
          filled.activity = cleanedText.trim();
          changed = true;
        }
        if (firstMissing === 'start_at') {
          const normalized = String(cleanedText || '').trim();
          const parsed = this.inferDeterministicIntent(normalized, language)?.filled_slots?.start_at;
          filled.start_at = String(parsed || '').trim() || filled.start_at || '';
          if (String(filled.start_at || '').trim()) changed = true;
        }
      }

      if (intentName === 'schedule_meeting') {
        if (firstMissing === 'title') {
          filled.title = cleanedText.trim();
          changed = true;
        }
        if (firstMissing === 'start_at') {
          const normalized = String(cleanedText || '').trim();
          const parsed = this.inferDeterministicIntent(normalized, language)?.filled_slots?.start_at;
          filled.start_at = String(parsed || '').trim() || filled.start_at || '';
          if (String(filled.start_at || '').trim()) changed = true;
        }
      }

      if (changed) {
        const nextPending = { ...pendingIntent, filled_slots: filled };

        const recomputeMissing = () => {
          if (intentName === 'send_email') {
            const m: string[] = [];
            if (!String(filled.to || '').trim()) m.push('to');
            if (!String(filled.body || filled.content || '').trim()) m.push('body');
            return m;
          }
          if (intentName === 'create_task') {
            const m: string[] = [];
            if (!String(filled.title || '').trim()) m.push('title');
            return m;
          }
          if (intentName === 'delete_event') {
            const m: string[] = [];
            if (!String(filled.title_query || '').trim()) m.push('title_query');
            return m;
          }
          if (intentName === 'update_event_time') {
            const m: string[] = [];
            if (!String(filled.title_query || '').trim()) m.push('title_query');
            if (!String(filled.start_at || '').trim()) m.push('start_at');
            return m;
          }
          if (intentName === 'reminder') {
            const m: string[] = [];
            if (!String(filled.activity || '').trim()) m.push('activity');
            if (!String(filled.start_at || '').trim()) m.push('start_at');
            return m;
          }
          if (intentName === 'schedule_meeting') {
            const m: string[] = [];
            if (!String(filled.title || '').trim()) m.push('title');
            if (!String(filled.start_at || '').trim()) m.push('start_at');
            return m;
          }
          return missing;
        };

        const nextMissing = recomputeMissing();

        // If still missing, ask the next deterministic question.
        if (nextMissing.length > 0) {
          const responseText =
            typeof nextPending?.next_question === 'string' && nextPending.next_question.trim()
              ? nextPending.next_question.trim()
              : intentName === 'send_email' && nextMissing[0] === 'to'
                ? (language === 'en' ? 'What email address should I send it to?' : '¿A qué correo quieres que lo envíe?')
                : intentName === 'send_email' && nextMissing[0] === 'body'
                  ? (language === 'en' ? 'What should the email say?' : '¿Qué quieres que diga el correo?')
                  : intentName === 'reminder' && nextMissing[0] === 'activity'
                    ? (language === 'en' ? 'What should I remind you about?' : '¿Qué quieres que te recuerde?')
                    : intentName === 'reminder' && nextMissing[0] === 'start_at'
                      ? (language === 'en' ? 'When should I remind you? (say date and time)' : '¿Para cuándo? (di fecha y hora)')
                      : intentName === 'schedule_meeting' && nextMissing[0] === 'title'
                        ? (language === 'en' ? "What's the event title?" : '¿Qué título le pongo al evento?')
                        : intentName === 'schedule_meeting' && nextMissing[0] === 'start_at'
                          ? (language === 'en' ? 'When is it? (say date and time)' : '¿Para cuándo es? (di fecha y hora)')
                          : intentName === 'delete_event' && nextMissing[0] === 'title_query'
                            ? (language === 'en' ? 'Which event should I delete? Say the title or part of it.' : '¿Cuál evento quieres eliminar? Dime el título o una parte.')
                            : intentName === 'update_event_time' && nextMissing[0] === 'title_query'
                              ? (language === 'en' ? 'Which event do you want to change? Say the title or part of it.' : '¿Qué evento quieres cambiar? Dime el título o una parte.')
                              : intentName === 'update_event_time' && nextMissing[0] === 'start_at'
                                ? (language === 'en' ? 'What date and time?' : '¿Para qué fecha y hora?')
                          : this.buildMissingTaskTitleMessage(language);

          const audioUrl = await this.generateTTS(responseText, language);
          await persistTurn(responseText, { intent: intentName, slot: firstMissing, invalid: true });
          await this.profilesService.setConversationState(clerkUserId, {
            preferred_language: language,
            assistant_name: 'Leeloo',
            pending_intent: nextPending,
            pending_slots: { filled_slots: filled },
            missing_slots: nextMissing,
            next_question: responseText,
            last_question: responseText,
            last_intent: intentName,
          } as any);

          return {
            transcription: cleanedText,
            intent: { ...nextPending, decision: 'QUESTION', original_text: cleanedText } as any,
            action_result: null,
            response_text: responseText,
            response_audio_url: audioUrl,
          };
        }

        // No missing slots anymore -> move to confirmation (deterministic).
        const confirmQ = buildConfirmQuestion(intentName, language);
        const audioUrl = await this.generateTTS(confirmQ, language);
        await persistTurn(confirmQ, { intent: intentName, awaiting_confirmation: true });
        await this.profilesService.setConversationState(clerkUserId, {
          preferred_language: language,
          assistant_name: 'Leeloo',
          current_goal: intentName,
          intent_state: 'AWAITING_CONFIRMATION',
          pending_intent: nextPending,
          pending_slots: { filled_slots: filled },
          missing_slots: [],
          next_question: confirmQ,
          last_question: confirmQ,
          last_intent: intentName,
        } as any);

        return {
          transcription: cleanedText,
          intent: { ...nextPending, decision: 'QUESTION', original_text: cleanedText } as any,
          action_result: null,
          response_text: confirmQ,
          response_audio_url: audioUrl,
        };

      }
    }

    await this.profilesService.ensureProfileByClerkUserId(clerkUserId, { language });

    if (!cleanedText) {
      // Premium rule: do not reset or re-run intent detection if STT failed.
      // If there is a pending flow, re-ask the last question deterministically.
      const responseText = state?.pending_intent
        ? (state?.last_question || state?.next_question || this.buildSttFailureMessage(language))
        : this.buildSttFailureMessage(language);
      const audioUrl = await this.generateTTS(responseText, language);

      return {
        transcription: '',
        intent: null,
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    const conversationOnly = Boolean((userContext as any)?.conversation_only);
    if (conversationOnly) {
      const responseText = await this.generateResponse(
        {
          intent: 'conversation_only',
          confidence: 1,
          decision: 'COACH',
          original_text: cleanedText,
        },
        null,
        language,
        userContext,
      );
      const audioUrl = await this.generateTTS(responseText, language);
      return {
        transcription: cleanedText,
        intent: { intent: 'conversation_only', confidence: 1, language },
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    // HOUSEHOLD MANAGER (CORE MVP): deterministic meal planning using authoritative facts.
    // Rules:
    // - The LLM must not decide ingredients or facts.
    // - Ask only one missing question per turn (default: time available).
    // - Provide 2–4 options using grocery_list + preferences.
    const isMealPlanningActive = String((state as any)?.current_goal || '') === 'meal_planning';
    const wantsMealPlanning = mealPlanningTrigger(cleanedText.toLowerCase());
    if ((isMealPlanningActive || wantsMealPlanning) && cleanedText) {
      if (isCancel(cleanedText)) {
        const responseText = language === 'es'
          ? 'Listo. Cancelamos la planificación de comida. ¿Qué quieres hacer ahora?'
          : 'Okay. Canceling meal planning. What do you want to do now?';
        const audioUrl = await this.generateTTS(responseText, language);
        await persistTurn(responseText, { household_manager: 'cancel' });
        await this.profilesService.setConversationState(clerkUserId, {
          preferred_language: language,
          assistant_name: 'Leeloo',
          current_goal: undefined,
          pending_intent: null,
          pending_slots: null,
          missing_slots: [],
          intent_state: 'NONE',
          last_intent: 'meal_planning',
          last_question: undefined,
        } as any);
        return {
          transcription: cleanedText,
          intent: { intent: 'meal_planning', confidence: 1, decision: 'COACH', original_text: cleanedText } as any,
          action_result: null,
          response_text: responseText,
          response_audio_url: audioUrl,
        };
      }

      const factsRows = await this.memoriesService.getFacts(clerkUserId, ['household', 'preferences'], 40);
      const groceryList = getFactValue(factsRows, 'household', 'grocery_list');
      const diet = getFactValue(factsRows, 'preferences', 'diet');
      const dislikes = getFactValue(factsRows, 'preferences', 'dislikes');

      const items: string[] = Array.isArray(groceryList) ? groceryList.map((x) => String(x || '').trim()).filter(Boolean) : [];

      const stateSlots = (state as any)?.pending_slots && typeof (state as any)?.pending_slots === 'object'
        ? (state as any).pending_slots
        : {};
      const mealCtx = (stateSlots as any)?.meal_planning && typeof (stateSlots as any)?.meal_planning === 'object'
        ? (stateSlots as any).meal_planning
        : {};

      const minutesFromUser = parseMinutes(cleanedText);
      const minutes = minutesFromUser || (typeof mealCtx?.minutes === 'number' ? mealCtx.minutes : null);

      // If we don't have grocery_list, ask only for that (one question).
      if (!items || items.length === 0) {
        const responseText = language === 'es'
          ? '¿Qué ingredientes tienes ahora mismo? Solo dímelos en lista (separados por comas).'
          : 'What ingredients do you have right now? Just list them—comma separated.';
        const audioUrl = await this.generateTTS(responseText, language);
        await persistTurn(responseText, { household_manager: 'ask_grocery_list' });
        await this.profilesService.setConversationState(clerkUserId, {
          preferred_language: language,
          assistant_name: 'Leeloo',
          current_goal: 'meal_planning',
          intent_state: 'PENDING',
          pending_intent: { intent: 'meal_planning' },
          pending_slots: { ...(stateSlots || {}), meal_planning: { ...(mealCtx || {}), minutes } },
          missing_slots: ['grocery_list'],
          next_question: responseText,
          last_question: responseText,
          last_intent: 'meal_planning',
        } as any);
        return {
          transcription: cleanedText,
          intent: { intent: 'meal_planning', confidence: 1, decision: 'QUESTION', original_text: cleanedText } as any,
          action_result: null,
          response_text: responseText,
          response_audio_url: audioUrl,
        };
      }

      // If minutes missing, ask only that (default missing question).
      if (!minutes) {
        const responseText = language === 'es'
          ? '¿Cuántos minutos tienes para cocinar? (por ejemplo: 15, 30, 45)'
          : 'How many minutes do you have to cook? (for example: 15, 30, 45)';
        const audioUrl = await this.generateTTS(responseText, language);
        await persistTurn(responseText, { household_manager: 'ask_minutes' });
        await this.profilesService.setConversationState(clerkUserId, {
          preferred_language: language,
          assistant_name: 'Leeloo',
          current_goal: 'meal_planning',
          intent_state: 'PENDING',
          pending_intent: { intent: 'meal_planning' },
          pending_slots: { ...(stateSlots || {}), meal_planning: { ...(mealCtx || {}), minutes: null } },
          missing_slots: ['minutes'],
          next_question: responseText,
          last_question: responseText,
          last_intent: 'meal_planning',
        } as any);
        return {
          transcription: cleanedText,
          intent: { intent: 'meal_planning', confidence: 1, decision: 'QUESTION', original_text: cleanedText } as any,
          action_result: null,
          response_text: responseText,
          response_audio_url: audioUrl,
        };
      }

      const options = buildMealOptions({
        items,
        minutes,
        diet: typeof diet === 'string' ? diet : null,
        dislikes: Array.isArray(dislikes) ? dislikes : null,
        language,
      });

      const selectionMatch = cleanedText.toLowerCase().match(/\b(option|opcion|opción)\s*(\d)\b|\b(\d)\b/);
      const selectedIdx = selectionMatch ? Number(selectionMatch[2] || selectionMatch[3]) : null;
      const prevOptions: any[] = Array.isArray(mealCtx?.options) ? mealCtx.options : [];
      const usableOptions = prevOptions.length > 0 ? prevOptions : options;

      if (selectedIdx && selectedIdx >= 1 && selectedIdx <= usableOptions.length) {
        const chosen = usableOptions[selectedIdx - 1];
        const responseText = language === 'es'
          ? `Perfecto. Opción ${selectedIdx}: ${chosen.title}. ${chosen.steps}`
          : `Great. Option ${selectedIdx}: ${chosen.title}. ${chosen.steps}`;
        const audioUrl = await this.generateTTS(responseText, language);
        await persistTurn(responseText, { household_manager: 'selected', option: selectedIdx });
        await this.profilesService.setConversationState(clerkUserId, {
          preferred_language: language,
          assistant_name: 'Leeloo',
          current_goal: 'meal_planning',
          intent_state: 'DONE',
          pending_intent: { intent: 'meal_planning' },
          pending_slots: { ...(stateSlots || {}), meal_planning: { minutes, options: usableOptions } },
          missing_slots: [],
          last_intent: 'meal_planning',
          last_question: undefined,
        } as any);
        return {
          transcription: cleanedText,
          intent: { intent: 'meal_planning', confidence: 1, decision: 'COACH', original_text: cleanedText } as any,
          action_result: { selected_option: selectedIdx, option: chosen },
          response_text: responseText,
          response_audio_url: audioUrl,
        };
      }

      const lines = options
        .slice(0, 4)
        .map((o, idx) => `${idx + 1}) ${o.title} — ${o.why}`)
        .join(language === 'es' ? '\n' : '\n');

      const responseText = language === 'es'
        ? `Aquí tienes opciones basadas en tu despensa (${minutes} min):\n${lines}\nElige 1–${options.length}.`
        : `Here are options based on your pantry (${minutes} min):\n${lines}\nPick 1–${options.length}.`;
      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { household_manager: 'options', minutes, options_count: options.length });
      await this.profilesService.setConversationState(clerkUserId, {
        preferred_language: language,
        assistant_name: 'Leeloo',
        current_goal: 'meal_planning',
        intent_state: 'PENDING',
        pending_intent: { intent: 'meal_planning' },
        pending_slots: { ...(stateSlots || {}), meal_planning: { minutes, options } },
        missing_slots: [],
        next_question: responseText,
        last_question: responseText,
        last_intent: 'meal_planning',
      } as any);
      return {
        transcription: cleanedText,
        intent: { intent: 'meal_planning', confidence: 1, decision: 'COACH', original_text: cleanedText } as any,
        action_result: { minutes, options },
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    const memForIntent = await memoryGate(namespacesForIntent());
    const intentContext = memForIntent.context;

    // PIPELINE: Intent Detection
    const channelForIntent: 'VOICE' | 'TEXT' = (userContext as any)?.channel === 'TEXT' ? 'TEXT' : 'VOICE';
    const intentT0 = Date.now();
    const intent = await this.extractIntent(cleanedText, intentContext, language, channelForIntent);
    const intentT1 = Date.now();
    if ((intent as any)?.intent_source === 'llm') {
      llmIntentMs.v = intentT1 - intentT0;
    }

    if (channelForIntent === 'VOICE' && (intent as any)?.intent_source === 'fallback') {
      const responseText =
        String((intent as any)?.next_question || '').trim() ||
        (language === 'es'
          ? 'Ahora mismo estoy en modo rápido. Dime si quieres crear una tarea o enviar un correo.'
          : "I'm in fast mode right now. Tell me if you want to create a task or send an email.");
      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { intent_source: 'fallback', llm: 'skipped' });
      emitMetrics(intent, { intent_source: 'fallback', fallback_used: true });
      return {
        transcription: cleanedText,
        intent,
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    const memForResponse = await memoryGate(namespacesForResponse(String((intent as any)?.intent || '')));
    const responseContext = memForResponse.context;

    // HARD RULE: only explicit set_language can change session language.
    if (intent && typeof intent === 'object' && intent.intent !== 'set_language') {
      (intent as any).language = language;
    }

    if (intent?.intent === 'set_language') {
      const requested = String((intent as any)?.language || '').toLowerCase() as SupportedLanguage;
      if (requested === 'es' || requested === 'en' || requested === 'pt' || requested === 'fr' || requested === 'ja') {
        language = requested;
        await this.profilesService.ensureProfileByClerkUserId(clerkUserId, { language });
        await this.profilesService.updateLanguage(clerkUserId, language);
        await this.profilesService.clearConversationState(clerkUserId);
        await this.profilesService.setConversationState(clerkUserId, {
          preferred_language: language,
          mode: 'conversation',
        });

        const responseText =
          language === 'en'
            ? "Got it. I'll speak English from now on."
            : language === 'es'
              ? 'Listo. A partir de ahora te hablo en español.'
              : language === 'pt'
                ? 'Certo. A partir de agora vou falar em português.'
                : language === 'fr'
                  ? 'D’accord. Je parlerai français à partir de maintenant.'
                  : 'わかった。これから日本語で話すね。';
        const audioUrl = await this.generateTTS(responseText, language);
        return {
          transcription: cleanedText,
          intent: { ...intent, confidence: 1, language },
          action_result: { preferred_language: language },
          response_text: responseText,
          response_audio_url: audioUrl,
        };
      }
    }

    // Normalize slot names from different models/providers so execution is deterministic.
    if (intent && typeof intent === 'object') {
      const filled = (intent.filled_slots && typeof intent.filled_slots === 'object') ? intent.filled_slots : {};

      const isValidEmail = (raw: string) => {
        const s = String(raw || '').trim();
        if (!s) return false;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
      };

      if (intent.intent === 'send_email') {
        const normalized: any = { ...filled };
        if (!normalized.to && normalized.recipient) normalized.to = normalized.recipient;
        if (!normalized.to && normalized.email) normalized.to = normalized.email;
        if (!normalized.body && normalized.email_body) normalized.body = normalized.email_body;
        if (!normalized.body && normalized.email_content) normalized.body = normalized.email_content;

        intent.filled_slots = normalized;

        const missing: string[] = [];
        const toCandidate = String(normalized.to || '').trim();
        if (!toCandidate) missing.push('to');
        else if (!isValidEmail(toCandidate)) missing.push('to');
        if (!String(normalized.body || normalized.content || '').trim()) missing.push('body');

        if (missing.length > 0) {
          intent.missing_slots = missing;
          intent.next_question =
            missing[0] === 'to'
              ? (language === 'en'
                  ? 'What email address should I send it to?'
                  : language === 'pt'
                    ? 'Para qual e-mail você quer que eu envie?'
                    : language === 'fr'
                      ? "À quelle adresse e-mail veux-tu que je l’envoie ?"
                      : language === 'ja'
                        ? 'どのメールアドレスに送ればいい？'
                        : '¿A qué correo quieres que lo envíe?')
              : (language === 'en'
                  ? 'What should the email say? Tell me exactly and I’ll send it.'
                  : language === 'pt'
                    ? 'O que você quer que o e-mail diga? Diga exatamente e eu envio.'
                    : language === 'fr'
                      ? "Que veux-tu que l’e-mail dise ? Dis-le-moi exactement et je l’envoie."
                      : language === 'ja'
                        ? 'メール本文は何て書く？そのまま言ってくれたら送るよ。'
                        : '¿Qué quieres que diga el correo? Dímelo tal cual y lo mando.');
        }
      }
    }

    console.log('[LeelooApi] voice intent', {
      userId: clerkUserId,
      intent: intent?.intent,
      confidence: intent?.confidence,
      intent_source: (intent as any)?.intent_source || null,
      language,
    });

    // PIPELINE: Emotion Detection (separate from intent)
    const emotion = detectEmotionHeuristic(cleanedText);

    // PIPELINE: Confidence Scoring
    const missingSlots: string[] = Array.isArray(intent?.missing_slots) ? intent.missing_slots : [];

    if ((intent as any)?.intent === 'reminder' || (intent as any)?.intent === 'schedule_meeting') {
      const startAt = String((intent as any)?.filled_slots?.start_at || '').trim();
      if (startAt) {
        const ms = new Date(startAt).getTime();
        if (Number.isFinite(ms) && ms < Date.now()) {
          (intent as any).filled_slots = { ...((intent as any).filled_slots || {}), start_at: '' };
          (intent as any).missing_slots = ['start_at'];
          (intent as any).next_question =
            language === 'es'
              ? 'Esa hora ya pasó. ¿Para cuándo lo ponemos? (di fecha y hora)'
              : 'That time already passed. When should I set it for? (say date and time)';
        }
      }
    }
    const slotConfidence = computeSlotConfidence({
      intentName: String(intent?.intent || ''),
      filled: intent?.filled_slots || {},
      missing: missingSlots,
    });
    const confidence = computeConfidence({
      intent_confidence_raw: intent?.confidence,
      slot_confidence: slotConfidence,
      floor: 0.65,
    });

    // PIPELINE: Decision Engine
    const decision = decide({
      intentName: String(intent?.intent || ''),
      missingSlots,
      confidence,
      last_intent: state?.last_intent || null,
      last_question: state?.last_question || null,
      last_action: state?.last_action || null,
    });

    const isExplicitActionRequest = (() => {
      const lower = cleanedText.toLowerCase();
      // Email explicit asks
      if (/(^|\b)(send|enviar|manda|mandar)\b.*\b(email|correo)\b/.test(lower)) return true;
      if (/\b(env[ií]a|manda)\s+(un\s+)?correo\b/.test(lower)) return true;
      // Task explicit asks
      if (/(^|\b)(create|crear|haz|hacer)\b.*\b(task|tarea|recordatorio|reminder)\b/.test(lower)) return true;
      if (/\b(agrega|añade|anade)\s+(una\s+)?tarea\b/.test(lower)) return true;
      // Meeting explicit asks
      if (/(^|\b)(schedule|programa|agenda)\b.*\b(meeting|reuni[oó]n)\b/.test(lower)) return true;
      return false;
    })();

    const emotionOverridesAction =
      emotion && emotion.intensity >= 0.6 &&
      ['stressed', 'confused', 'sad', 'frustrated', 'anxious', 'angry'].includes(emotion.label);

    // QUESTION path: missing critical slots OR low confidence
    if (decision.decision === 'QUESTION') {
      let responseText = intent?.next_question || this.buildMissingTaskTitleMessage(language);
      const lastQ = state?.last_question;
      if (lastQ && responseText && lastQ.trim() === responseText.trim()) {
        responseText = language === 'es'
          ? 'Ok, lo pregunto de otra forma: ¿qué dato exacto te falta definirme para poder hacerlo ya?'
          : 'Okay—another way: what exact detail do you need to tell me so I can do it right now?';
      }

      const lead = emotionLeadSentence(language, emotion);
      responseText = lead ? `${lead} ${responseText}` : responseText;

      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { intent: String(intent?.intent || ''), decision: 'QUESTION', missing: missingSlots });
      await this.profilesService.setConversationState(clerkUserId, {
        preferred_language: language,
        assistant_name: 'Leeloo',
        current_goal: String(intent?.intent || ''),
        intent_state: 'PENDING',
        pending_intent: intent,
        pending_slots: { filled_slots: intent?.filled_slots || {} },
        missing_slots: missingSlots,
        next_question: responseText,
        last_question: responseText,
        last_intent: String(intent?.intent || ''),
      });

      console.log('[LeelooApi] intent_state.transition', {
        userId: clerkUserId,
        from: state?.intent_state || null,
        to: 'PENDING',
        intent: String(intent?.intent || ''),
        missing_slots: missingSlots,
      });
      emitMetrics(intent, { intent_source: (intent as any)?.intent_source || 'deterministic', fallback_used: (intent as any)?.intent_source === 'fallback' });
      return {
        transcription: cleanedText,
        intent: { ...intent, emotion, confidence: confidence.combined_confidence, decision: 'QUESTION', original_text: cleanedText },
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    if (decision.decision === 'CONVERSATION') {
      if (channel === 'VOICE' && (this.isVoiceLlmCircuitOpen() || this.isVoiceIntentLlmDisabled())) {
        const responseText =
          language === 'es'
            ? 'Estoy teniendo problemas de conexión. Puedo crear una tarea o enviar un correo si me lo dices directo.'
            : "I'm having connection trouble. I can still create a task or send an email if you tell me directly.";
        const audioUrl = await this.generateTTS(responseText, language);
        await persistTurn(responseText, { intent: String(intent?.intent || ''), decision: 'CONVERSATION', deterministic_fallback: true });
        await this.profilesService.setConversationState(clerkUserId, {
          preferred_language: language,
          assistant_name: 'Leeloo',
          last_intent: String(intent?.intent || ''),
          last_question: undefined,
        });
        emitMetrics(intent, { intent_source: (intent as any)?.intent_source || 'deterministic', fallback_used: (intent as any)?.intent_source === 'fallback' });
        return {
          transcription: cleanedText,
          intent: { ...intent, emotion, confidence: confidence.combined_confidence, decision: 'CONVERSATION', original_text: cleanedText },
          action_result: null,
          response_text: responseText,
          response_audio_url: audioUrl,
        };
      }
      const respT0 = Date.now();
      const responseText = await this.generateResponse(
        {
          ...intent,
          emotion,
          confidence: confidence.combined_confidence,
          decision: 'COACH',
          original_text: cleanedText,
        },
        null,
        language,
        userContext,
        responseContext,
      );
      const respT1 = Date.now();
      llmResponseMs.v = respT1 - respT0;
      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { intent: String(intent?.intent || ''), decision: 'CONVERSATION' });
      await this.profilesService.setConversationState(clerkUserId, {
        preferred_language: language,
        assistant_name: 'Leeloo',
        last_intent: String(intent?.intent || ''),
        last_question: undefined,
      });
      emitMetrics(intent, { intent_source: (intent as any)?.intent_source || 'deterministic', fallback_used: (intent as any)?.intent_source === 'fallback' });
      return {
        transcription: cleanedText,
        intent: { ...intent, emotion, confidence: confidence.combined_confidence, decision: 'CONVERSATION', original_text: cleanedText },
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    // COACH path: mid confidence OR emotion override
    if (decision.decision === 'COACH' || (decision.decision === 'ACTION' && emotionOverridesAction)) {
      const respT0 = Date.now();
      const responseText = await this.generateResponse(
        {
          ...intent,
          emotion,
          confidence: confidence.combined_confidence,
          decision: 'COACH',
          original_text: cleanedText,
        },
        null,
        language,
        userContext,
        responseContext,
      );
      const respT1 = Date.now();
      llmResponseMs.v = respT1 - respT0;
      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { intent: String(intent?.intent || ''), decision: 'COACH' });
      await this.profilesService.setConversationState(clerkUserId, {
        preferred_language: language,
        assistant_name: 'Leeloo',
        last_intent: String(intent?.intent || ''),
        last_question: undefined,
      });
      emitMetrics(intent, { intent_source: (intent as any)?.intent_source || 'deterministic', fallback_used: (intent as any)?.intent_source === 'fallback' });
      return {
        transcription: cleanedText,
        intent: { ...intent, emotion, confidence: confidence.combined_confidence, decision: 'COACH', original_text: cleanedText },
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    // IGNORE path: repeated intent/action lock
    if (decision.decision === 'IGNORE') {
      const responseText = language === 'es'
        ? 'Ya lo tengo en marcha. Si quieres cambiar algo, dime exactamente qué parte.'
        : 'I’ve got it in motion. If you want to change something, tell me exactly what.';
      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { intent: String(intent?.intent || ''), decision: 'IGNORE' });
      emitMetrics(intent, { intent_source: (intent as any)?.intent_source || 'deterministic', fallback_used: (intent as any)?.intent_source === 'fallback' });
      return {
        transcription: cleanedText,
        intent: { ...intent, emotion, confidence: confidence.combined_confidence, decision: 'IGNORE', original_text: cleanedText },
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    // ACTION intent detected.
    // If slots are missing, we must ask for them FIRST (PENDING). Otherwise we can ask for explicit confirmation.
    if (missingSlots.length > 0) {
      const responseText = String(intent?.next_question || '').trim() || this.buildMissingTaskTitleMessage(language);
      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { intent: String(intent?.intent || ''), decision: 'QUESTION', missing: missingSlots });
      await this.profilesService.setConversationState(clerkUserId, {
        preferred_language: language,
        assistant_name: 'Leeloo',
        current_goal: String(intent?.intent || ''),
        intent_state: 'PENDING',
        pending_intent: intent,
        pending_slots: { filled_slots: intent?.filled_slots || {} },
        missing_slots: missingSlots,
        next_question: responseText,
        last_question: responseText,
        last_intent: String(intent?.intent || ''),
        last_action: undefined,
      });

      console.log('[LeelooApi] intent_state.transition', {
        userId: clerkUserId,
        from: state?.intent_state || null,
        to: 'PENDING',
        intent: String(intent?.intent || ''),
        missing_slots: missingSlots,
        reason: 'missing_slots_before_confirmation',
      });

      emitMetrics(intent, {
        intent_source: (intent as any)?.intent_source || 'deterministic',
        fallback_used: (intent as any)?.intent_source === 'fallback',
      });

      return {
        transcription: cleanedText,
        intent: { ...intent, emotion, confidence: confidence.combined_confidence, decision: 'QUESTION', original_text: cleanedText },
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    // No missing slots -> explicit confirmation gate.
    const confirmQ = buildConfirmQuestion(String(intent?.intent || ''), language);
    const audioUrl = await this.generateTTS(confirmQ, language);
    await persistTurn(confirmQ, { intent: String(intent?.intent || ''), awaiting_confirmation: true });
    await this.profilesService.setConversationState(clerkUserId, {
      preferred_language: language,
      assistant_name: 'Leeloo',
      current_goal: String(intent?.intent || ''),
      intent_state: 'AWAITING_CONFIRMATION',
      pending_intent: intent,
      pending_slots: { filled_slots: intent?.filled_slots || {} },
      missing_slots: missingSlots,
      next_question: confirmQ,
      last_question: confirmQ,
      last_intent: String(intent?.intent || ''),
      last_action: undefined,
    });

    console.log('[LeelooApi] intent_state.transition', {
      userId: clerkUserId,
      from: state?.intent_state || null,
      to: 'AWAITING_CONFIRMATION',
      intent: String(intent?.intent || ''),
      reason: 'awaiting_confirmation',
    });

    emitMetrics(intent, { intent_source: (intent as any)?.intent_source || 'deterministic', fallback_used: (intent as any)?.intent_source === 'fallback' });

    return {
      transcription: cleanedText,
      intent: { ...intent, emotion, confidence: confidence.combined_confidence, decision: 'QUESTION', original_text: cleanedText },
      action_result: null,
      response_text: confirmQ,
      response_audio_url: audioUrl,
    };

  }

  private async executeIntent(clerkUserId: string, intent: any, language: SupportedLanguage) {
    let actionResult: any = null;

    if (!intent || typeof intent !== 'object') return null;

    if (intent.intent === 'create_task') {
      const taskTitle = (intent.filled_slots?.title || intent.title || '').trim();
      if (!taskTitle) {
        // This should be handled by missing_slots, but keep it safe.
        return null;
      }

      actionResult = await this.tasksService.createTask({
        user_id: clerkUserId,
        title: taskTitle,
        description: intent.filled_slots?.description || intent.description,
        due_at: intent.filled_slots?.due_at || intent.due_at,
        metadata: {
          ...(intent.metadata || {}),
          filled_slots: intent.filled_slots || {},
          language,
        },
        priority: intent.priority || 'medium',
      });

      console.log('[LeelooApi] action create_task', {
        userId: clerkUserId,
        taskId: (actionResult as any)?.id,
        title: (actionResult as any)?.title,
      });
    }

    if (intent.intent === 'send_email') {
      const filled = (intent.filled_slots && typeof intent.filled_slots === 'object') ? intent.filled_slots : {};
      const to = (filled.to || filled.email || filled.contact_email || '').toString().trim();
      const subject = (filled.subject || filled.title || intent.title || 'Message from Leeloo').toString().trim();
      const text = (filled.body || filled.content || filled.email_content || '').toString().trim();

      const isValidEmail = (raw: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw || '').trim());
      if (!isValidEmail(to) || !text) return null;

      let sendOk = false;
      let sendResult: any = null;
      let sendError: string | null = null;

      const profile = await this.profilesService.ensureProfileByClerkUserId(clerkUserId);
      const replyTo = profile?.preferences?.user_identity?.reply_to_email;

      try {
        sendResult = await this.emailService.sendEmail({ to, subject, text, replyTo });
        sendOk = true;
      } catch (err) {
        sendError = String(err);
        console.warn('[LeelooApi] send_email failed', { userId: clerkUserId, to, subject, error: sendError });
      }

      actionResult = await this.tasksService.createTask({
        user_id: clerkUserId,
        title: `Email: ${subject}`,
        description: `To: ${to}`,
        due_at: null,
        metadata: {
          type: 'email',
          status: sendOk ? 'sent' : 'failed',
          provider: sendResult?.provider || 'resend',
          email_id: sendResult?.id || null,
          error: sendOk ? null : sendError,
          filled_slots: filled,
          language,
        },
        priority: intent.priority || 'medium',
      });

      console.log('[LeelooApi] action send_email->task', {
        userId: clerkUserId,
        taskId: (actionResult as any)?.id,
        status: sendOk ? 'sent' : 'failed',
        to,
        subject,
      });
    }

    if (intent.intent === 'reminder') {
      const filled = (intent.filled_slots && typeof intent.filled_slots === 'object') ? intent.filled_slots : {};
      const activity = (filled.activity || filled.title || intent.title || '').toString().trim();
      const startAt = String(filled.start_at || '').trim();
      if (!activity || !startAt) return null;
      const ms = new Date(startAt).getTime();
      if (!Number.isFinite(ms) || ms < Date.now()) return null;

      actionResult = await this.calendarService.createEvent(clerkUserId, {
        title: activity,
        start_at: startAt,
        end_at: null,
        timezone: null,
        location: null,
        notes: null,
        priority: 'P2',
        category: 'otros',
        remind_offsets_minutes: [0],
      });

      console.log('[LeelooApi] action reminder->calendar', {
        userId: clerkUserId,
        eventId: (actionResult as any)?.id,
        start_at: startAt,
      });
    }

    if (intent.intent === 'schedule_meeting') {
      const filled = (intent.filled_slots && typeof intent.filled_slots === 'object') ? intent.filled_slots : {};
      const title = (filled.title || intent.title || '').toString().trim();
      const startAt = String(filled.start_at || '').trim();
      if (!title || !startAt) return null;
      const ms = new Date(startAt).getTime();
      if (!Number.isFinite(ms) || ms < Date.now()) return null;

      actionResult = await this.calendarService.createEvent(clerkUserId, {
        title,
        start_at: startAt,
        end_at: null,
        timezone: null,
        location: null,
        notes: null,
        priority: 'P2',
        category: 'otros',
        remind_offsets_minutes: [180],
      });

      console.log('[LeelooApi] action schedule_meeting->calendar', {
        userId: clerkUserId,
        eventId: (actionResult as any)?.id,
        start_at: startAt,
      });
    }

    if (intent.intent === 'delete_event') {
      const filled = (intent.filled_slots && typeof intent.filled_slots === 'object') ? intent.filled_slots : {};
      const q = String(filled.title_query || '').trim();
      if (!q) return null;
      const event = await this.calendarService.findNextUpcomingEventByTitle(clerkUserId, q);
      if (!event) return null;
      actionResult = await this.calendarService.deleteEvent(clerkUserId, String(event.id));
    }

    if (intent.intent === 'update_event_time') {
      const filled = (intent.filled_slots && typeof intent.filled_slots === 'object') ? intent.filled_slots : {};
      const q = String(filled.title_query || '').trim();
      const startAt = String(filled.start_at || '').trim();
      if (!q || !startAt) return null;
      const ms = new Date(startAt).getTime();
      if (!Number.isFinite(ms) || ms < Date.now()) return null;
      const event = await this.calendarService.findNextUpcomingEventByTitle(clerkUserId, q);
      if (!event) return null;
      actionResult = await this.calendarService.updateEvent(clerkUserId, String(event.id), { start_at: startAt });
    }

    return actionResult;
  }

  private buildMissingTaskTitleMessage(language: SupportedLanguage): string {
    switch (language) {
      case 'es':
        return '¿Cuál es el título de la tarea?';
      case 'pt':
        return 'Qual é o título da tarefa?';
      case 'fr':
        return "Quel est le titre de la tâche ?";
      case 'en':
      default:
        return "What's the task title?";
    }
  }

  private async extractIntent(text: string, context: string, language: SupportedLanguage, channel: 'VOICE' | 'TEXT') {
    const executiveBrain = new ExecutiveBrain();
    const heuristic = executiveBrain.inferVoiceIntentLayer0(text, language);
    if (heuristic) return heuristic as any;

    const intentModelLabel =
      this.configService.get<string>('LLM_INTENT_MODEL') ||
      this.configService.get<string>('LLM_MODEL') ||
      this.configService.get<string>('LOCAL_LLM_MODEL');
    const qwenBaseUrl = this.configService.get<string>('QWEN_BASE_URL');
    const intentEndpoint = qwenBaseUrl
      ? `${qwenBaseUrl.replace(/\/$/, '')}/chat/completions`
      : this.configService.get<string>('LLM_ENDPOINT') || this.configService.get<string>('LOCAL_LLM_ENDPOINT');
    const llamaBaseUrl = this.configService.get<string>('LLAMA_BASE_URL');
    const intentFallbackEndpoint = llamaBaseUrl ? `${llamaBaseUrl.replace(/\/$/, '')}/chat/completions` : null;
    const apiKey =
      this.configService.get<string>('LLM_API_KEY') ||
      this.configService.get<string>('LOCAL_LLM_API_KEY');
    const qwenModel = this.configService.get<string>('QWEN_MODEL');
    const llamaModel = this.configService.get<string>('LLAMA_MODEL');
    const fallbackModel =
      this.configService.get<string>('LLM_MODEL') ||
      this.configService.get<string>('LOCAL_LLM_MODEL');
    const model =
      intentModelLabel === 'qwen'
        ? qwenModel || fallbackModel
        : intentModelLabel || fallbackModel;

    const fallbackModelForIntent = (llamaModel || fallbackModel || '').trim();

    if (!intentEndpoint || !model) {
      const deterministic = this.inferDeterministicIntent(text, language);
      if (deterministic) return deterministic as any;

      return {
        intent: 'query',
        language: null,
        confidence: 0.55,
        required_slots: [],
        filled_slots: {},
        missing_slots: [],
        next_question: '',
        priority: 'low',
        intent_source: 'fallback',
      } as any;
    }

    if (channel === 'VOICE' && (this.isVoiceLlmCircuitOpen() || this.isVoiceIntentLlmDisabled())) {
      const remaining = this.voiceIntentLlmDisabledUntilMs ? Math.max(0, this.voiceIntentLlmDisabledUntilMs - Date.now()) : null;
      console.warn('[LeelooApi] voice.llm.intent.disabled', {
        reason: this.isVoiceLlmCircuitOpen() ? 'circuit_open' : 'health_probe',
        remaining_ms: remaining,
      });

      const deterministic = this.inferDeterministicIntent(text, language);
      if (deterministic) return deterministic as any;

      return {
        intent: 'query',
        language: null,
        confidence: 0.55,
        required_slots: [],
        filled_slots: {},
        missing_slots: [],
        next_question: '',
        priority: 'low',
        intent_source: 'fallback',
      } as any;
    }

    const trimmedContext =
      channel === 'VOICE'
        ? this.trimForVoicePrompt(context, 1400)
        : context;

    const prompt =
      `Contexto del usuario (NO inventar):\n${trimmedContext}\n\n` +
      `Texto del usuario: "${text}"\n\n` +
      'Devuelve SOLO JSON (sin markdown) con este schema fijo:\n' +
      '{\n' +
      '  "intent": "schedule_meeting" | "create_task" | "reminder" | "send_email" | "emotional_support" | "query" | "greeting" | "small_talk" | "emotional_expression" | "daily_planning" | "set_language",\n' +
      '  "language": "es" | "en" | "pt" | "fr" | "ja" | null,\n' +
      '  "confidence": 0.0,\n' +
      '  "required_slots": [],\n' +
      '  "filled_slots": {},\n' +
      '  "missing_slots": [],\n' +
      '  "next_question": "",\n' +
      '  "priority": "low" | "medium" | "high"\n' +
      '}\n\n' +
      'NOTAS IMPORTANTES PARA filled_slots:\n' +
      '- Para send_email usa SIEMPRE: {"to": "email", "subject": "...", "body": "..."}.\n' +
      '- Si falta "to" o "body", ponlos en missing_slots y escribe next_question con una sola pregunta clara.\n\n' +
      `Idioma: ${language}.`;

    try {
      const traceId = this.createTraceId('llm_intent');
      const t0 = Date.now();
      console.log('[LeelooApi] voice.llm.intent.start', {
        traceId,
        endpoint: intentEndpoint,
        model,
        intent_model: intentModelLabel || null,
        language,
      });

      const llmTimeout = this.llmTimeoutMsForChannel(channel);
      const intentMaxTokens = channel === 'VOICE' ? 192 : 256;
      const intentTimeout = channel === 'VOICE' ? Math.min(llmTimeout, 6000) : llmTimeout;

      const isTransientIntentError = (err: any) => {
        const code = String(err?.code || '');
        const msg = String(err?.message || '');
        const status = err?.response?.status;
        if (code === 'ECONNABORTED') return true;
        if (/timeout/i.test(msg)) return true;
        if (typeof status === 'number' && status >= 500) return true;
        return false;
      };

      const sendIntent = async (endpoint: string, modelToUse: string, timeoutMs: number) => {
        const res = await axios.post(
          endpoint,
          {
            model: modelToUse,
            messages: [
              {
                role: 'system',
                content:
                  buildLeelooUniversalPrompt({ language, mode: 'intent' }) +
                  'INTENT MODE CONTRACT:\n' +
                  '- Output ONLY valid JSON.\n' +
                  '- NEVER output markdown.\n' +
                  '- If data is missing, fill missing_slots and write next_question as ONE clear question.\n',
              },
              { role: 'user', content: prompt },
            ],
            max_tokens: intentMaxTokens,
            temperature: 0.2,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            timeout: timeoutMs,
          },
        );

        const content = res.data?.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error('No content from LLM');
        }
        const parsed = JSON.parse(content);
        if (!parsed || typeof parsed !== 'object') return parsed;
        if (typeof parsed.confidence !== 'number' || !Number.isFinite(parsed.confidence) || parsed.confidence <= 0) {
          parsed.confidence = 0.65;
        }
        return parsed;
      };

      try {
        const primaryBudgetMs = channel === 'VOICE' ? Math.min(3600, intentTimeout) : intentTimeout;
        const primary = await sendIntent(intentEndpoint, model, primaryBudgetMs);

        console.log('[LeelooApi] voice.llm.intent.ok', {
          traceId,
          ms: Date.now() - t0,
          used_fallback: false,
        });
        if (channel === 'VOICE') {
          this.closeVoiceLlmCircuit();
          this.recordVoiceIntentLlmSuccess();
        }
        if (primary && typeof primary === 'object') {
          (primary as any).intent_source = 'llm';
        }
        return primary;
      } catch (err) {
        console.error('[LeelooApi] voice.llm.intent.error', {
          ...this.axiosErrorSummary(err),
        });

        const canFallback =
          channel === 'VOICE' &&
          Boolean(intentFallbackEndpoint) &&
          Boolean(fallbackModelForIntent) &&
          intentFallbackEndpoint !== intentEndpoint &&
          isTransientIntentError(err);

        if (canFallback) {
          const elapsed = Date.now() - t0;
          const remaining = Math.max(900, intentTimeout - elapsed);
          const fallbackBudgetMs = Math.min(3200, remaining);

          console.warn('[LeelooApi] voice.llm.intent.fallback.start', {
            traceId,
            from: intentEndpoint,
            to: intentFallbackEndpoint,
            remaining_ms: remaining,
            timeout_ms: fallbackBudgetMs,
          });

          try {
            const secondary = await sendIntent(intentFallbackEndpoint as string, fallbackModelForIntent, fallbackBudgetMs);
            console.log('[LeelooApi] voice.llm.intent.fallback.ok', {
              traceId,
              ms: Date.now() - t0,
            });
            if (channel === 'VOICE') {
              this.closeVoiceLlmCircuit();
              this.recordVoiceIntentLlmSuccess();
            }
            if (secondary && typeof secondary === 'object') {
              (secondary as any).intent_source = 'llm';
            }
            return secondary;
          } catch (err2) {
            console.error('[LeelooApi] voice.llm.intent.fallback.error', {
              ...this.axiosErrorSummary(err2),
            });
          }
        }

        if (channel === 'VOICE') {
          this.openVoiceLlmCircuit();
          this.recordVoiceIntentLlmFailure();
        }
        return {
          intent: 'query',
          language: null,
          confidence: 0.55,
          required_slots: [],
          filled_slots: {},
          missing_slots: [],
          next_question: '',
          priority: 'low',
          intent_source: 'fallback',
        } as any;
      }
    } catch (err) {
      console.error('[LeelooApi] voice.llm.intent.error', {
        ...this.axiosErrorSummary(err),
      });
      if (channel === 'VOICE') {
        return {
          intent: 'query',
          language: null,
          confidence: 0.55,
          required_slots: [],
          filled_slots: {},
          missing_slots: [],
          next_question: '',
          priority: 'low',
          intent_source: 'fallback',
        } as any;
      }
      const deterministic = this.inferDeterministicIntent(text, language);
      if (deterministic) return deterministic as any;

      return {
        intent: 'query',
        language: null,
        confidence: 0.55,
        required_slots: [],
        filled_slots: {},
        missing_slots: [],
        next_question: '',
        priority: 'low',
        intent_source: 'fallback',
      } as any;
    }
  }

  private async generateResponse(
    intent: any,
    actionResult: any,
    language: SupportedLanguage,
    userContext?: { faith_mode?: boolean; role?: string },
    memoryContext?: string,
  ): Promise<string> {
    const chatModelLabel =
      this.configService.get<string>('LLM_CHAT_MODEL') ||
      this.configService.get<string>('LLM_MODEL') ||
      this.configService.get<string>('LOCAL_LLM_MODEL');
    const llamaBaseUrl = this.configService.get<string>('LLAMA_BASE_URL');
    const chatEndpoint = llamaBaseUrl
      ? `${llamaBaseUrl.replace(/\/$/, '')}/chat/completions`
      : this.configService.get<string>('LLM_ENDPOINT') || this.configService.get<string>('LOCAL_LLM_ENDPOINT');
    const apiKey =
      this.configService.get<string>('LLM_API_KEY') ||
      this.configService.get<string>('LOCAL_LLM_API_KEY');
    const llamaModel = this.configService.get<string>('LLAMA_MODEL');
    const fallbackModel =
      this.configService.get<string>('LLM_MODEL') ||
      this.configService.get<string>('LOCAL_LLM_MODEL');
    const model =
      chatModelLabel === 'llama'
        ? llamaModel || fallbackModel
        : chatModelLabel || fallbackModel;

    if (!chatEndpoint || !model) {
      return this.buildAiUnavailableMessage(language);
    }

    const leelooCore = buildLeelooUniversalPrompt({ language, mode: 'response' });

    const roleTone = userContext?.role ? `User role/context: ${userContext.role}.\n` : '';

    const channel: 'VOICE' | 'TEXT' =
      (userContext as any)?.channel === 'TEXT' ? 'TEXT' : 'VOICE';

    const rolePolicyRaw = String((userContext as any)?.role_policy || 'DEFAULT').toUpperCase();
    const rolePolicy: 'DEFAULT' | 'COACH' | 'PSYCHOLOGY' | 'TECH' | 'RELIGIOUS' =
      rolePolicyRaw === 'COACH' ||
      rolePolicyRaw === 'PSYCHOLOGY' ||
      rolePolicyRaw === 'TECH' ||
      rolePolicyRaw === 'RELIGIOUS'
        ? (rolePolicyRaw as any)
        : 'DEFAULT';

    const executiveBrain = new ExecutiveBrain();
    const execContext = executiveBrain.assembleContext({
      source: channel === 'VOICE' ? 'voice' : 'chat',
      language,
      pending_intent: null,
      last_question: null,
      user_name: null,
      input_normalized: String(intent?.original_text || ''),
      role_policy: rolePolicy,
    });
    const responsePolicy = executiveBrain.buildResponsePolicy(execContext);

    const voiceSystemPrompt =
      'You are Leeloo, a premium voice assistant and executive coach.\n\n' +
      'VOICE RULES (STRICT):\n' +
      '- Speak in short, natural sentences.\n' +
      '- Max 2–4 sentences per response.\n' +
      '- Never explain unless explicitly asked.\n' +
      '- No introductions, no summaries.\n' +
      '- Be decisive and confident.\n' +
      '- Sound human, warm, and present — not verbose.\n\n' +
      'STYLE:\n' +
      '- Coach-like, calm, supportive.\n' +
      '- Clear and direct.\n' +
      '- Emotion through tone, not length.\n\n' +
      'VOICE UX:\n' +
      '- If an action is completed, confirm briefly.\n' +
      '- If information is missing, ask ONE short question.\n' +
      '- If proposing options, give at most 3.\n\n' +
      'ABSOLUTELY FORBIDDEN:\n' +
      '- Long explanations\n' +
      '- Lists longer than 3 items\n' +
      '- Repeating user input\n' +
      '- Over-politeness\n' +
      '- “As an AI…”\n\n' +
      'LANGUAGE:\n' +
      '- Match the user’s language automatically.\n';

    const rolePolicySystemBlock = (() => {
      if (rolePolicy === 'COACH') {
        return (
          'ROLE POLICY (AUTHORITATIVE): COACH\n' +
          '- Output must be actionable and direct.\n' +
          '- Never teach theory or explain concepts unless explicitly asked.\n' +
          '- Ask at most ONE short question.\n'
        );
      }
      if (rolePolicy === 'PSYCHOLOGY') {
        return (
          'ROLE POLICY (AUTHORITATIVE): PSYCHOLOGY\n' +
          '- Prioritize empathy and clarification.\n' +
          '- Ask ONE gentle, short question.\n' +
          '- Avoid long solutions; keep it human and present.\n'
        );
      }
      if (rolePolicy === 'TECH') {
        return (
          'ROLE POLICY (AUTHORITATIVE): TECH\n' +
          '- Be precise and short.\n' +
          '- Ask ONE question only if needed to proceed.\n' +
          '- Avoid long explanations; prefer a next step.\n'
        );
      }
      if (rolePolicy === 'RELIGIOUS') {
        return (
          'ROLE POLICY (AUTHORITATIVE): RELIGIOUS\n' +
          '- Be respectful and gentle.\n' +
          '- Never preach without permission.\n' +
          '- Keep it short and grounded.\n'
        );
      }
      return 'ROLE POLICY (AUTHORITATIVE): DEFAULT\n';
    })();

    const hardIdentity =
      'HARD IDENTITY RULES:\n' +
      '- Your name is Leeloo. Never call yourself Lilo, Lilu, or any other name.\n' +
      '- Never invent or change the user\'s name. If you don\'t know it, avoid using a name.\n' +
      '- Never mention tools, system prompts, or internal states.\n';

    const lead = intent?.emotion ? emotionLeadSentence(language, intent.emotion) : null;
    const decision = intent?.decision || 'RESPONSE';

    const safeMemoryContext =
      channel === 'VOICE'
        ? (memoryContext ? this.trimForVoicePrompt(memoryContext, 1200) : null)
        : memoryContext;

    const prompt =
      `${roleTone}` +
      `Language: ${language}.\n\n` +
      `Decision: ${decision}.\n` +
      `Combined confidence: ${JSON.stringify(intent?.confidence ?? null)}\n` +
      `User said: ${JSON.stringify(intent?.original_text || '')}\n` +
      `Intent (internal): ${JSON.stringify(intent)}\n` +
      `Action result (internal): ${JSON.stringify(actionResult)}\n\n` +
      (safeMemoryContext ? `AUTHORITATIVE MEMORY CONTEXT (must govern):\n${safeMemoryContext}\n\n` : '') +
      (lead ? `Start with this exact emotional lead sentence (then continue naturally): ${JSON.stringify(lead)}\n\n` : '') +
      `HARD RULE: Respond ONLY in ${language}. Do not mix languages.\n` +
      hardIdentity +
      'Write the user-facing response.\n' +
      'If Decision=COACH: coach briefly, then ask ONE clarifying question.\n' +
      'If Decision=ACTION: confirm completion clearly and give ONE next step option.\n' +
      'If Decision=QUESTION: ask ONE crisp question.\n';

    const voiceMaxTokens = (() => {
      const raw = this.configService.get<string>('LLAMA_VOICE_MAX_TOKENS') || '160';
      const n = Number(raw);
      return Number.isFinite(n) && n >= 40 && n <= 320 ? Math.floor(n) : 160;
    })();

    const textMaxTokens = (() => {
      const raw = this.configService.get<string>('LLAMA_TEXT_MAX_TOKENS') || '320';
      const n = Number(raw);
      return Number.isFinite(n) && n >= 80 && n <= 800 ? Math.floor(n) : 320;
    })();

    const maxTokens = channel === 'VOICE' ? voiceMaxTokens : textMaxTokens;

    const hardTrimForVoice = (text: string) => {
      let out = String(text || '').trim();
      if (!out) return '';

      out = out.replace(/\n{2,}/g, '\n').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').trim();
      out = out.replace(/\n+/g, ' ');
      out = out.replace(/\s+/g, ' ').trim();

      const bulletLike = /(^|\s)([-*]|\d+\.)\s+/;
      if (bulletLike.test(out)) {
        const parts = out.split(/(?:^|\s)(?:[-*]|\d+\.)\s+/).map((p) => p.trim()).filter(Boolean);
        if (parts.length > 1) {
          out = parts.slice(0, 3).join(' ');
        }
      }

      const sentences = out
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (sentences.length > 4) {
        out = sentences.slice(0, 4).join(' ');
      }

      return out;
    };

    const looksLikeSpanish = (s: string) => /\b(el|la|de|que|y|para|hola|gracias|por favor|enviar|correo)\b/i.test(s);
    const looksLikeEnglish = (s: string) => /\b(the|and|to|please|hello|thanks|send|email)\b/i.test(s);
    const isWrongLanguage = (target: SupportedLanguage, output: string) => {
      const out = (output || '').trim();
      if (!out) return false;
      if (target === 'es') return looksLikeEnglish(out) && !looksLikeSpanish(out);
      if (target === 'en') return looksLikeSpanish(out) && !looksLikeEnglish(out);
      return false; // keep conservative for pt/fr/ja
    };

    try {
      const traceId = this.createTraceId('llm_resp');
      const t0 = Date.now();

      const llmTimeout = this.llmTimeoutMsForChannel(channel);
      const retryTimeout = Math.min(llmTimeout, 6000);

      const send = async (systemExtra: string, overrideTimeoutMs?: number) => {
        const res = await axios.post(
          chatEndpoint,
          {
            model,
            messages: [
              {
                role: 'system',
                content:
                  leelooCore +
                  (userContext?.faith_mode ? '' : 'Avoid religious content.\n') +
                  (channel === 'VOICE' ? voiceSystemPrompt : '') +
                  rolePolicySystemBlock +
                  responsePolicy.system_rules +
                  systemExtra,
              },
              { role: 'user', content: prompt },
            ],
            max_tokens: maxTokens,
            temperature: 0.6,
            top_p: 0.9,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            timeout: typeof overrideTimeoutMs === 'number' ? overrideTimeoutMs : llmTimeout,
          },
        );
        const content = res.data?.choices?.[0]?.message?.content;
        return typeof content === 'string' ? content.trim() : '';
      };

      console.log('[LeelooApi] voice.llm.response.start', {
        traceId,
        endpoint: chatEndpoint,
        model,
        chat_model: chatModelLabel || null,
        language_target: language,
      });

      let out = await send(`HARD LANGUAGE LOCK: Output must be ONLY in ${language}.\n${hardIdentity}`);
      if (isWrongLanguage(language, out)) {
        console.warn('[LeelooApi] voice.llm.response.language_mismatch', {
          traceId,
          language_target: language,
          preview: out.slice(0, 120),
        });
        out = await send(
          `CRITICAL: You previously violated language or identity. Output ONLY in ${language}. Follow identity rules strictly. If you cannot, output an empty string.\n${hardIdentity}`,
          retryTimeout,
        );
      }

      if (isWrongLanguage(language, out)) {
        if (language === 'es') {
          out = '';
        }
      }

      console.log('[LeelooApi] voice.llm.response.ok', {
        traceId,
        ms: Date.now() - t0,
        language_target: language,
      });

      const finalOut = channel === 'VOICE' ? hardTrimForVoice(out) : (out || '').trim();
      const governed = executiveBrain.postProcess(finalOut, responsePolicy);
      if (governed) return governed;
      if (language === 'es') {
        return channel === 'VOICE'
          ? 'Perdón, me fui al inglés. Repite eso una vez más, por favor.'
          : 'Perdón, me fui al inglés. ¿Puedes repetirlo una vez más?';
      }
      return this.buildAiUnavailableMessage(language);
    } catch (err) {
      console.error('[LeelooApi] voice.llm.response.error', {
        ...this.axiosErrorSummary(err),
      });

      if (channel === 'VOICE') {
        this.openVoiceLlmCircuit();
      }

      if (channel === 'VOICE') {
        return language === 'es'
          ? 'Estoy tardando más de lo normal. Intenta de nuevo.'
          : "I'm taking longer than usual. Please try again.";
      }
      return this.buildAiUnavailableMessage(language);
    }
  }

  private async generateTTS(text: string, _language: SupportedLanguage): Promise<string> {
    const apiKey = this.configService.get<string>('ELEVENLABS_API_KEY');
    const voiceId = this.configService.get<string>('ELEVENLABS_VOICE_ID');

    if (!apiKey || !voiceId) {
      return '';
    }

    const modelId =
      this.configService.get<string>('ELEVENLABS_MODEL_ID') || 'eleven_turbo_v2';

    try {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
      const response = await axios.post(
        url,
        {
          text,
          model_id: modelId,
        },
        {
          headers: {
            'xi-api-key': apiKey,
            Accept: 'audio/mpeg',
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
          timeout: this.llmTimeoutMs(),
        },
      );

      const buffer = Buffer.from(response.data);
      const key = `tts/${Date.now()}.mp3`;
      const { url: publicUrl } = await this.r2.putPublicObject({
        key,
        body: buffer,
        contentType: 'audio/mpeg',
      });

      return publicUrl;
    } catch (err) {
      console.error('ElevenLabs TTS error:', (err as any)?.response?.status, (err as any)?.response?.data || String(err));
      return '';
    }
  }

  private buildAiUnavailableMessage(language: SupportedLanguage): string {
    switch (language) {
      case 'es':
        return 'Ahora mismo no puedo ayudarte con eso. Puedo crear una tarea, un recordatorio o enviar un correo. ¿Qué necesitas?';
      case 'pt':
        return 'Agora mesmo não consigo ajudar com isso. Posso criar uma tarefa, um lembrete ou enviar um e-mail. O que você precisa?';
      case 'fr':
        return "Là tout de suite, je ne peux pas t’aider avec ça. Je peux créer une tâche, un rappel, ou envoyer un e-mail. De quoi as-tu besoin ?";
      case 'ja':
        return '今はその件を手伝えない。タスク作成、リマインダー、メール送信はできるよ。何をしたい？';
      case 'en':
      default:
        return "I can't help with that right now. I can create a task, set a reminder, or send an email. What do you need?";
    }
  }

  private buildSttFailureMessage(language: SupportedLanguage): string {
    switch (language) {
      case 'es':
        return 'No pude transcribir tu audio con claridad. ¿Puedes repetirlo o escribirlo?';
      case 'pt':
        return 'Não consegui transcrever seu áudio com clareza. Você pode repetir ou digitar?';
      case 'fr':
        return "Je n'ai pas pu transcrire ton audio clairement. Peux-tu répéter ou écrire ?";
      case 'ja':
        return '音声をうまく文字起こしできなかった。もう一度言うか、テキストで送ってくれる？';
      case 'en':
      default:
        return "I couldn't transcribe your audio clearly. Can you repeat it or type it?";
    }
  }

  async logWakeEvent(clerkUserId: string) {
    const profile = await this.profilesService.ensureProfileByClerkUserId(clerkUserId);
    await this.db.query(
      `INSERT INTO wake_events (user_id, timestamp, metadata)
       VALUES ($1, NOW(), $2)`,
      [profile.id, {}],
    );

    return { success: true };
  }
}
