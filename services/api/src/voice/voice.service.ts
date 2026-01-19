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
import { buildLeelooUniversalPrompt } from './core/leeloo-core.prompt';
import { detectEmotionHeuristic, emotionLeadSentence } from './core/emotion';
import { computeConfidence, computeSlotConfidence } from './core/confidence';
import { decide } from './core/decision-engine';

@Injectable()
export class VoiceService {
  private readonly openai: OpenAI | null;

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
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.openai = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async transcribeAudio(
    audioBuffer: Buffer,
    userContext?: { language?: string },
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

    const language = (userContext?.language || 'en').toLowerCase();

    console.log('[LeelooApi] voice.stt.start', {
      traceId,
      bytes: audioBuffer.length,
      language,
      hasEndpoint: Boolean(endpoint),
      endpoint,
      hasOpenAI: Boolean(this.openai),
    });

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
              timeout: 120000,
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
              await sleep(900);
              try {
                res = await axios.post(url, form, {
                  timeout: 120000,
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
              timeout: 120000,
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
    userContext?: { language?: string; faith_mode?: boolean; role?: string },
  ) {
    const cleanedText = (text || '').trim();

    // Resolve persisted user state (language + pending intent/slots).
    const profile =
      (await this.profilesService.getProfileByClerkUserId(clerkUserId)) ||
      (await this.profilesService.ensureProfileByClerkUserId(clerkUserId));
    const state = this.profilesService.getConversationState(profile);

    const conversationMode: 'conversation' | 'action' =
      (state?.mode === 'action' || state?.mode === 'conversation')
        ? state.mode
        : 'conversation';

    const normalize = (s: string) =>
      String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const normalizeForDecision = (s: string) => {
      let out = normalize(s);
      out = out
        .replace(/\b(este|eh|mmm|mm|um|uh|pues|bueno|okey|oye|a ver)\b/g, ' ')
        .replace(/\b(por favor|pls|please|gracias|muchas gracias)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return out;
    };

    type DecisionToken = 'YES' | 'NO' | 'CANCEL' | 'OTHER';

    const decisionToken = (raw: string): DecisionToken => {
      const s = normalizeForDecision(raw);
      if (!s) return 'OTHER';

      const cancel =
        s === 'cancel' ||
        s === 'cancelar' ||
        s.includes('cancela eso') ||
        s.includes('cancelalo') ||
        s.includes('olvidalo') ||
        s.includes('olvidate') ||
        s.includes('ya no') ||
        s.includes('no lo hagas') ||
        s.includes('no lo envies') ||
        s.includes('no lo mandes');
      if (cancel) return 'CANCEL';

      const yesRegex = /^(si|s i|claro|dale|ok|okay|vale|de una|hazlo|envialo|mandalo|adelante|confirma|confirmo|yes|yeah|yep|sure|go ahead|do it|send it|send it now|confirm)(\b|$)/;
      const noRegex = /^(no|negativo|mejor no|no gracias|nope|nah|dont|do not|don t|stop)(\b|$)/;

      const hasYes =
        yesRegex.test(s) ||
        /\bsi\b/.test(s) ||
        /\byes\b/.test(s) ||
        s.includes('claro que si') ||
        s.includes('por supuesto') ||
        s.includes('of course') ||
        s.includes('sure');

      const hasNo =
        noRegex.test(s) ||
        /\bno\b/.test(s) ||
        /\bnope\b/.test(s) ||
        /\bnah\b/.test(s);

      if (hasYes && !hasNo) return 'YES';
      if (hasNo && !hasYes) return 'NO';
      return 'OTHER';
    };

    const isCancel = (raw: string) => decisionToken(raw) === 'CANCEL';
    const isConfirm = (raw: string) => decisionToken(raw) === 'YES';

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

    // Global voice commands (bypass LLM)
    const lowerGlobal = cleanedText.toLowerCase();
    const isWake =
      lowerGlobal.includes('leeloo despierta') ||
      lowerGlobal.includes('leeloo, despierta') ||
      lowerGlobal.includes('wake up') ||
      lowerGlobal.includes('leeloo wake up');
    const isSleep =
      lowerGlobal.includes('leeloo apágate') ||
      lowerGlobal.includes('leeloo apagate') ||
      lowerGlobal.includes('leeloo, apágate') ||
      lowerGlobal.includes('leeloo, apagate') ||
      lowerGlobal.includes('sleep') ||
      lowerGlobal.includes('go to sleep') ||
      lowerGlobal.includes('leeloo sleep');

    if (isWake) {
      await this.profilesService.setConversationState(clerkUserId, {
        preferred_language: language,
        system_on: true,
      });
      const responseText = language === 'es' ? 'Estoy aquí. ¿Qué necesitas?' : "I'm here. What do you need?";
      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { system: 'wake' });
      return {
        transcription: cleanedText,
        intent: { intent: 'system_on', confidence: 1 },
        action_result: { system_on: true },
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    if (isSleep) {
      await this.profilesService.setConversationState(clerkUserId, {
        preferred_language: language,
        system_on: false,
      });
      const responseText = language === 'es' ? 'Listo. Me quedo en silencio. Cuando me necesites, di “Leeloo despierta”.' : 'Okay. Going quiet. When you need me, say “Leeloo wake up”.';
      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { system: 'sleep' });
      return {
        transcription: cleanedText,
        intent: { intent: 'system_off', confidence: 1 },
        action_result: { system_on: false },
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    const systemOn = this.profilesService.getSystemOn(profile);
    if (!systemOn) {
      const responseText = language === 'es' ? 'Estoy en silencio. Si quieres que vuelva, di “Leeloo despierta”.' : 'I’m quiet right now. If you want me back, say “Leeloo wake up”.';
      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { system: 'off' });
      return {
        transcription: cleanedText,
        intent: { intent: 'system_off', confidence: 1 },
        action_result: { system_on: false },
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    const t = cleanedText.toLowerCase();
    const isGreeting =
      /^\s*(hola|buenas|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|hey|hello|hi|yo)\b/.test(t) ||
      /^\s*(c[oó]mo\s+est[aá]s|how\s+are\s+you)\b/.test(t);

    const conversationalIntent = (() => {
      const lower = t;
      const isEmotional =
        /\b(estoy\s+(triste|mal|ansioso|ansiosa|estresado|estresada|frustrado|frustrada|enojado|enojada)|me\s+siento\s+(triste|mal|ansioso|ansiosa|estresado|estresada|frustrado|frustrada|enojado|enojada))\b/.test(lower) ||
        /\b(i\s*(am|'m)\s+(sad|down|anxious|stressed|frustrated|angry)|i\s+feel\s+(sad|down|anxious|stressed|frustrated|angry))\b/.test(lower);

      const isDailyPlanning =
        /\b(planifica(mi\s+d[ií]a|el\s+d[ií]a)|organiza(mi\s+d[ií]a|el\s+d[ií]a)|agenda|mi\s+agenda|qu[eé]\s+tengo\s+hoy|hoy\s+qu[eé]\s+tengo)\b/.test(lower) ||
        /\b(plan\s+my\s+day|organize\s+my\s+day|my\s+schedule|what\s+do\s+i\s+have\s+today|today\s+what\s+do\s+i\s+have)\b/.test(lower);

      const isSmallTalk =
        /^\s*(gracias|thank\s+you)\b/.test(lower) ||
        /^\s*(qu[eé]\s+tal|todo\s+bien|c[oó]mo\s+vas|what'?s\s+up|how'?s\s+it\s+going)\b/.test(lower);

      if (isGreeting) {
        return { intent: 'greeting', confidence: 0.95 };
      }
      if (isEmotional) {
        return { intent: 'emotional_expression', confidence: 0.9 };
      }
      if (isDailyPlanning) {
        return { intent: 'daily_planning', confidence: 0.9 };
      }
      if (isSmallTalk) {
        return { intent: 'small_talk', confidence: 0.85 };
      }
      return null;
    })();

    // Premium safety: if the user greets while a send_email flow is pending,
    // cancel the pending flow instead of treating the greeting as the email body.
    if (state?.pending_intent && isGreeting && String(state.pending_intent?.intent || '') === 'send_email') {
      const responseText =
        language === 'es'
          ? 'Hola. Estoy aquí contigo. ¿Cómo estás hoy, de verdad?'
          : "Hey. I’m here with you. How are you—really?";
      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { intent: 'send_email', cancel: true, reason: 'greeting_while_pending' });
      await this.profilesService.setConversationState(clerkUserId, {
        preferred_language: language,
        assistant_name: 'Leeloo',
        current_goal: undefined,
        intent_state: 'NONE',
        pending_intent: null,
        pending_slots: null,
        missing_slots: [],
        last_intent: 'query',
        last_action: undefined,
        last_question: responseText,
      });
      return {
        transcription: cleanedText,
        intent: { intent: 'query', confidence: 0.9, decision: 'COACH', original_text: cleanedText },
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    // Normal deterministic greeting gate (prevents intent bias from recent action context).
    // Only applies when we're NOT in a pending slot-filling flow.
    if (!state?.pending_intent && isGreeting) {
      const responseText =
        language === 'es'
          ? 'Hola. Qué gusto escucharte. ¿Cómo estás hoy, de verdad?'
          : "Hey. I’m really glad you’re here. How are you—really?";
      const audioUrl = await this.generateTTS(responseText, language);
      await this.profilesService.setConversationState(clerkUserId, {
        preferred_language: language,
        last_intent: 'query',
        last_action: undefined,
        last_question: responseText,
      });
      return {
        transcription: cleanedText,
        intent: { intent: 'query', confidence: 0.9, decision: 'COACH', original_text: cleanedText },
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    const lower = t;
    let requestedLanguage: SupportedLanguage | null = null;
    const wantsEnglish =
      lower.includes('english') ||
      lower.includes('inglés') ||
      lower.includes('ingles') ||
      lower.includes('speak english') ||
      lower.includes('in english') ||
      lower.includes('habla en inglés') ||
      lower.includes('habla en ingles') ||
      lower.includes('cambia a inglés') ||
      lower.includes('cambia a ingles');
    const wantsSpanish =
      lower.includes('español') ||
      lower.includes('espanol') ||
      lower.includes('spanish') ||
      lower.includes('speak spanish') ||
      lower.includes('in spanish') ||
      lower.includes('habla en español') ||
      lower.includes('habla en espanol') ||
      lower.includes('cambia a español') ||
      lower.includes('cambia a espanol');
    const wantsPortuguese =
      lower.includes('portugu') ||
      lower.includes('speak portuguese') ||
      lower.includes('in portuguese') ||
      lower.includes('habla en portugu') ||
      lower.includes('cambia a portugu');
    const wantsFrench =
      lower.includes('français') ||
      lower.includes('francais') ||
      lower.includes('french') ||
      lower.includes('speak french') ||
      lower.includes('in french') ||
      lower.includes('habla en francés') ||
      lower.includes('habla en frances') ||
      lower.includes('cambia a francés') ||
      lower.includes('cambia a frances');

    if (wantsEnglish) {
      requestedLanguage = 'en';
    } else if (wantsSpanish) {
      requestedLanguage = 'es';
    } else if (wantsPortuguese) {
      requestedLanguage = 'pt';
    } else if (wantsFrench) {
      requestedLanguage = 'fr';
    } else if (
      lower.includes('japanese') ||
      lower.includes('nihongo') ||
      lower.includes('日本語') ||
      lower.includes('japonés') ||
      lower.includes('japones')
    ) {
      requestedLanguage = 'ja';
    }

    if (requestedLanguage) {
      language = requestedLanguage;
      await this.profilesService.ensureProfileByClerkUserId(clerkUserId, { language });
      await this.profilesService.updateLanguage(clerkUserId, language);
      // Ensure no stale pending flow keeps forcing prior language/intent context.
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
        intent: { intent: 'set_language', confidence: 1, language },
        action_result: { preferred_language: language },
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    if (state?.pending_intent && cleanedText) {
      const pendingIntent = state.pending_intent;
      const pendingSlots = state.pending_slots || {};

      const pendingMissing: string[] = Array.isArray((pendingIntent as any)?.missing_slots)
        ? (pendingIntent as any).missing_slots
        : Array.isArray((state as any)?.missing_slots)
          ? ((state as any).missing_slots as any)
          : [];

      const token = decisionToken(cleanedText);

      if (pendingMissing.length === 0) {
        if ((state as any)?.intent_state !== 'AWAITING_CONFIRMATION') {
          await this.profilesService.setConversationState(clerkUserId, {
            preferred_language: language,
            assistant_name: 'Leeloo',
            current_goal: String(pendingIntent?.intent || ''),
            intent_state: 'AWAITING_CONFIRMATION',
            pending_intent: pendingIntent,
            pending_slots: pendingSlots,
            missing_slots: [],
          });
          console.log('[LeelooApi] intent_state.transition', {
            userId: clerkUserId,
            from: state?.intent_state || null,
            to: 'AWAITING_CONFIRMATION',
            reason: 'pending_no_missing_slots',
            intent: String(pendingIntent?.intent || ''),
          });
        }

        if (token === 'CANCEL' || token === 'NO') {
          console.log('[LeelooApi] intent_state.transition', {
            userId: clerkUserId,
            from: (state as any)?.intent_state || null,
            to: 'NONE',
            reason: token === 'CANCEL' ? 'cancel' : 'no',
            pending_intent: String(pendingIntent?.intent || ''),
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
          } as any);
          const responseText = language === 'es'
            ? 'Perfecto. No lo hago. ¿Qué quieres hacer ahora?'
            : "Okay. I won’t do it. What do you want to do now?";
          const audioUrl = await this.generateTTS(responseText, language);
          await persistTurn(responseText, { intent: String(pendingIntent?.intent || ''), decision: token });
          return {
            transcription: cleanedText,
            intent: { intent: 'cancel', confidence: 1, decision: 'COACH', original_text: cleanedText },
            action_result: null,
            response_text: responseText,
            response_audio_url: audioUrl,
          };
        }

        if (token === 'YES') {
          console.log('[LeelooApi] intent_state.transition', {
            userId: clerkUserId,
            from: (state as any)?.intent_state || null,
            to: 'CONFIRMED',
            pending_intent: String(pendingIntent?.intent || ''),
          });

          await this.profilesService.setConversationState(clerkUserId, {
            preferred_language: language,
            assistant_name: 'Leeloo',
            current_goal: String(pendingIntent?.intent || ''),
            intent_state: 'EXECUTING',
            pending_intent: pendingIntent,
            pending_slots: pendingSlots,
            missing_slots: [],
          });

          const actionResult = await this.executeIntent(clerkUserId, pendingIntent, language);

          await this.profilesService.setConversationState(clerkUserId, {
            preferred_language: language,
            assistant_name: 'Leeloo',
            current_goal: undefined,
            intent_state: 'EXECUTED',
            last_intent: String(pendingIntent?.intent || ''),
            last_action: String(pendingIntent?.intent || ''),
            pending_intent: null,
            pending_slots: null,
            missing_slots: [],
            next_question: undefined,
            last_question: undefined,
          });

          console.log('[LeelooApi] intent_state.transition', {
            userId: clerkUserId,
            from: 'EXECUTING',
            to: 'EXECUTED',
            intent: String(pendingIntent?.intent || ''),
          });

          await this.profilesService.setConversationState(clerkUserId, {
            preferred_language: language,
            assistant_name: 'Leeloo',
            intent_state: 'DONE',
          });

          let responseText: string;
          if (String(pendingIntent?.intent || '') === 'send_email') {
            const meta = (actionResult as any)?.metadata || {};
            const status = String(meta?.status || '').toLowerCase();
            const to = String((pendingIntent as any)?.filled_slots?.to || (pendingIntent as any)?.filled_slots?.email || '').trim();
            const subject = String((pendingIntent as any)?.filled_slots?.subject || (pendingIntent as any)?.filled_slots?.title || 'Message').trim();
            if (!actionResult) {
              responseText = language === 'es'
                ? 'Quise enviarlo, pero no recibí confirmación del sistema. ¿Quieres que lo intentemos de nuevo?'
                : "I tried, but I didn't get a system confirmation. Want me to retry?";
            } else if (status === 'sent') {
              responseText = language === 'es'
                ? `Listo. Ya envié el correo a ${to} con asunto "${subject}".`
                : `Done. I sent the email to ${to} with subject "${subject}".`;
            } else {
              responseText = language === 'es'
                ? 'Intenté enviar el correo, pero falló. ¿Quieres que lo intentemos otra vez?'
                : 'I tried to send it, but it failed. Want to try again?';
            }
          } else if (!actionResult) {
            responseText = language === 'es'
              ? 'Lo intenté, pero falló. ¿Quieres que lo intentemos de otra forma?'
              : 'I tried, but it failed. Want to try a different way?';
          } else {
            responseText = await this.generateResponse(
              { ...pendingIntent, decision: 'ACTION', original_text: cleanedText },
              actionResult,
              language,
              userContext,
            );
          }

          const audioUrl = await this.generateTTS(responseText, language);
          return {
            transcription: cleanedText,
            intent: { ...pendingIntent, decision: 'ACTION', original_text: cleanedText },
            action_result: actionResult,
            task_id: (actionResult as any)?.id || null,
            response_text: responseText,
            response_audio_url: audioUrl,
          };
        }

        const confirmQ = buildConfirmQuestion(String(pendingIntent?.intent || ''), language);
        const responseText = language === 'es'
          ? `${confirmQ} (Responde “sí” o “no”.)`
          : `${confirmQ} (Answer “yes” or “no”.)`;
        const audioUrl = await this.generateTTS(responseText, language);
        await persistTurn(responseText, { intent: String(pendingIntent?.intent || ''), awaiting_confirmation: true });
        await this.profilesService.setConversationState(clerkUserId, {
          preferred_language: language,
          assistant_name: 'Leeloo',
          current_goal: String(pendingIntent?.intent || ''),
          intent_state: 'AWAITING_CONFIRMATION',
          pending_intent: pendingIntent,
          pending_slots: pendingSlots,
          missing_slots: [],
          next_question: responseText,
          last_question: responseText,
          last_intent: String(pendingIntent?.intent || ''),
        });
        return {
          transcription: cleanedText,
          intent: pendingIntent,
          action_result: null,
          response_text: responseText,
          response_audio_url: audioUrl,
        };
      }

      if (isCancel(cleanedText)) {
        console.log('[LeelooApi] intent_state.transition', {
          userId: clerkUserId,
          from: state?.intent_state || null,
          to: 'NONE',
          reason: 'cancel',
          pending_intent: String(pendingIntent?.intent || ''),
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
        } as any);
        const responseText = language === 'es'
          ? 'Listo. Lo dejamos en pausa. ¿Qué quieres hacer ahora?'
          : 'Okay. We’ll drop that. What do you want to do now?';
        const audioUrl = await this.generateTTS(responseText, language);
        await persistTurn(responseText, { intent: String(pendingIntent?.intent || ''), cancel: true });
        return {
          transcription: cleanedText,
          intent: { intent: 'cancel', confidence: 1, decision: 'COACH', original_text: cleanedText },
          action_result: null,
          response_text: responseText,
          response_audio_url: audioUrl,
        };
      }

      const buildSendEmailNextQuestion = (slot: string): string => {
        if (slot === 'to') {
          switch (language) {
            case 'en':
              return 'What email address should I send it to?';
            case 'pt':
              return 'Para qual e-mail você quer que eu envie?';
            case 'fr':
              return "À quelle adresse e-mail veux-tu que je l’envoie ?";
            case 'ja':
              return 'どのメールアドレスに送ればいい？';
            case 'es':
            default:
              return '¿A qué correo quieres que lo envíe?';
          }
        }

        if (slot === 'body') {
          switch (language) {
            case 'en':
              return 'What should the email say? Tell me exactly and I’ll send it.';
            case 'pt':
              return 'O que você quer que o e-mail diga? Diga exatamente e eu envio.';
            case 'fr':
              return "Que veux-tu que l’e-mail dise ? Dis-le-moi exactement et je l’envoie.";
            case 'ja':
              return 'メール本文は何て書く？そのまま言ってくれたら送るよ。';
            case 'es':
            default:
              return '¿Qué quieres que diga el correo? Dímelo tal cual y lo mando.';
          }
        }

        switch (language) {
          case 'en':
            return "What's missing?";
          case 'pt':
            return 'O que está faltando?';
          case 'fr':
            return "Qu'est-ce qui manque ?";
          case 'ja':
            return '何が足りない？';
          case 'es':
          default:
            return '¿Qué dato te falta?';
        }
      };

      const missingSlots: string[] = Array.isArray(pendingIntent?.missing_slots)
        ? pendingIntent.missing_slots
        : [];
      const slotToFill = missingSlots[0] || null;

      if (slotToFill) {
        const normalizeEmail = (raw: string): string => {
          const s = String(raw || '').trim().toLowerCase();
          if (!s) return '';
          return s
            .replace(/\s+at\s+/g, '@')
            .replace(/\s+arroba\s+/g, '@')
            .replace(/\s+dot\s+/g, '.')
            .replace(/\s+punto\s+/g, '.')
            .replace(/\s+/g, '')
            .replace(/,+/g, '')
            .replace(/;+/g, '');
        };

        const value = slotToFill === 'to' ? normalizeEmail(cleanedText) : cleanedText;

        if (slotToFill === 'to') {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!value || !emailRegex.test(value)) {
            const responseText =
              language === 'es'
                ? 'No alcancé a captar bien el correo. Dímelo de nuevo, o deletrea el usuario y el dominio (por ejemplo: g-n-i-n-o arroba gmail punto com).'
                : "I didn't catch the email address clearly. Say it again, or spell it (for example: g-n-i-n-o at gmail dot com).";
            const audioUrl = await this.generateTTS(responseText, language);
            await this.profilesService.setConversationState(clerkUserId, {
              preferred_language: language,
              pending_intent: pendingIntent,
              pending_slots: { filled_slots: pendingSlots?.filled_slots || {} },
              next_question: responseText,
              last_question: responseText,
              last_intent: String(pendingIntent?.intent || ''),
            });
            return {
              transcription: cleanedText,
              intent: pendingIntent,
              action_result: null,
              response_text: responseText,
              response_audio_url: audioUrl,
            };
          }
        }

        const filled = {
          ...(pendingIntent?.filled_slots || {}),
          ...(pendingSlots?.filled_slots || {}),
          [slotToFill]: value,
        };

        const newMissing = missingSlots.slice(1);
        const updatedIntent = {
          ...pendingIntent,
          filled_slots: filled,
          missing_slots: newMissing,
        };

        if (newMissing.length > 0) {
          const responseText =
            String(updatedIntent?.intent || '') === 'send_email'
              ? buildSendEmailNextQuestion(String(newMissing[0] || ''))
              : (pendingIntent?.next_question || this.buildMissingTaskTitleMessage(language));
          const audioUrl = await this.generateTTS(responseText, language);
          await persistTurn(responseText, { intent: String(pendingIntent?.intent || ''), slot: slotToFill, invalid: true });
          await this.profilesService.setConversationState(clerkUserId, {
            preferred_language: language,
            pending_intent: updatedIntent,
            pending_slots: { filled_slots: filled },
            next_question: responseText,
            last_question: responseText,
            last_intent: String(updatedIntent?.intent || ''),
          });

          return {
            transcription: cleanedText,
            intent: updatedIntent,
            action_result: null,
            response_text: responseText,
            response_audio_url: audioUrl,
          };
        }

        // No more missing slots: DO NOT execute yet. Ask for explicit confirmation.
        const confirmQ = buildConfirmQuestion(String(updatedIntent?.intent || ''), language);
        const audioUrl = await this.generateTTS(confirmQ, language);
        await persistTurn(confirmQ, { intent: String(updatedIntent?.intent || ''), awaiting_confirmation: true });
        await this.profilesService.setConversationState(clerkUserId, {
          preferred_language: language,
          assistant_name: 'Leeloo',
          current_goal: String(updatedIntent?.intent || ''),
          intent_state: 'AWAITING_CONFIRMATION',
          pending_intent: updatedIntent,
          pending_slots: { filled_slots: filled },
          missing_slots: [],
          next_question: confirmQ,
          last_question: confirmQ,
          last_intent: String(updatedIntent?.intent || ''),
        });

        console.log('[LeelooApi] intent_state.transition', {
          userId: clerkUserId,
          from: state?.intent_state || null,
          to: 'AWAITING_CONFIRMATION',
          reason: 'slots_complete_awaiting_confirmation',
          intent: String(updatedIntent?.intent || ''),
        });

        return {
          transcription: cleanedText,
          intent: updatedIntent,
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

    // Get user context/memories
    const memories = await this.memoriesService.getRelevantMemories(clerkUserId, cleanedText);
    const recentTurns = await this.memoriesService.getRecentConversationTurns(clerkUserId, 5);
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
    const memoryContext = memories
      .map((m: any) => `${m.key}: ${JSON.stringify(m.value)}`)
      .join('\n');

    const fullContext = [turnsContext ? `Recent conversation:\n${turnsContext}` : null, memoryContext || null]
      .filter(Boolean)
      .join('\n\n');

    // PIPELINE: Intent Detection
    const intent = conversationalIntent || (await this.extractIntent(cleanedText, fullContext, language));

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

      if (intent.intent === 'send_email') {
        const normalized: any = { ...filled };
        if (!normalized.to && normalized.recipient) normalized.to = normalized.recipient;
        if (!normalized.to && normalized.email) normalized.to = normalized.email;
        if (!normalized.body && normalized.email_body) normalized.body = normalized.email_body;
        if (!normalized.body && normalized.email_content) normalized.body = normalized.email_content;

        intent.filled_slots = normalized;

        const missing: string[] = [];
        if (!String(normalized.to || '').trim()) missing.push('to');
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
      language,
    });

    if (intent?.intent === 'system_unavailable') {
      const responseText = intent?.next_question || this.buildAiUnavailableMessage(language);
      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { system_unavailable: true });

      return {
        transcription: cleanedText,
        intent,
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    // PIPELINE: Emotion Detection (separate from intent)
    const emotion = detectEmotionHeuristic(cleanedText);

    // PIPELINE: Confidence Scoring
    const missingSlots: string[] = Array.isArray(intent?.missing_slots) ? intent.missing_slots : [];
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
      return {
        transcription: cleanedText,
        intent: { ...intent, emotion, confidence: confidence.combined_confidence, decision: 'QUESTION', original_text: cleanedText },
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    if (decision.decision === 'CONVERSATION') {
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
      );
      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { intent: String(intent?.intent || ''), decision: 'CONVERSATION' });
      await this.profilesService.setConversationState(clerkUserId, {
        preferred_language: language,
        assistant_name: 'Leeloo',
        last_intent: String(intent?.intent || ''),
        last_question: undefined,
      });
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
      );
      const audioUrl = await this.generateTTS(responseText, language);
      await persistTurn(responseText, { intent: String(intent?.intent || ''), decision: 'COACH' });
      await this.profilesService.setConversationState(clerkUserId, {
        preferred_language: language,
        assistant_name: 'Leeloo',
        last_intent: String(intent?.intent || ''),
        last_question: undefined,
      });
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
      return {
        transcription: cleanedText,
        intent: { ...intent, emotion, confidence: confidence.combined_confidence, decision: 'IGNORE', original_text: cleanedText },
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    // ACTION intent detected, but NEVER execute without explicit confirmation.
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
      missing_slots: [],
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

    if (intent.intent === 'reminder') {
      const filled = intent.filled_slots || {};
      const activity = (filled.activity || filled.title || intent.title || '').toString().trim();
      const time = (filled.time || filled.time_frame || filled.due_at || '').toString().trim();
      const email = (filled.contact_email || filled.email || '').toString().trim();

      const title = activity ? `Reminder: ${activity}` : 'Reminder';
      const descriptionParts = [
        time ? `When: ${time}` : null,
        email ? `Notify: ${email}` : null,
      ].filter(Boolean);

      actionResult = await this.tasksService.createTask({
        user_id: clerkUserId,
        title,
        description: descriptionParts.length ? descriptionParts.join('\n') : null,
        due_at: null,
        metadata: {
          ...(intent.metadata || {}),
          filled_slots: filled,
          language,
          type: 'reminder',
        },
        priority: intent.priority || 'medium',
      });

      console.log('[LeelooApi] action reminder->task', {
        userId: clerkUserId,
        taskId: (actionResult as any)?.id,
        title: (actionResult as any)?.title,
      });
    }

    if (intent.intent === 'send_email') {
      const filled = intent.filled_slots || {};
      const to = (filled.to || filled.email || filled.contact_email || '').toString().trim();
      const subject = (filled.subject || filled.title || intent.title || 'Message from Leeloo').toString().trim();
      const text = (filled.body || filled.content || filled.email_content || '').toString().trim();

      if (to && text) {
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

  private async extractIntent(text: string, context: string, language: SupportedLanguage) {
    const endpoint =
      this.configService.get<string>('LLM_ENDPOINT') ||
      this.configService.get<string>('LOCAL_LLM_ENDPOINT');
    const apiKey =
      this.configService.get<string>('LLM_API_KEY') ||
      this.configService.get<string>('LOCAL_LLM_API_KEY');
    const model =
      this.configService.get<string>('LLM_MODEL') ||
      this.configService.get<string>('LOCAL_LLM_MODEL');

    if (!endpoint || !model) {
      return {
        intent: 'system_unavailable',
        confidence: 0.65,
        required_slots: [],
        filled_slots: {},
        missing_slots: [],
        next_question: this.buildAiUnavailableMessage(language),
        priority: 'low',
      };
    }

    const prompt =
      `Contexto del usuario (NO inventar):\n${context}\n\n` +
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
        endpoint,
        model,
        language,
      });
      const res = await axios.post(
        endpoint,
        {
          model,
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
          temperature: 0.2,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          timeout: 60000,
        },
      );

      const content = res.data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('No content from LLM');
      }

      console.log('[LeelooApi] voice.llm.intent.ok', {
        traceId,
        ms: Date.now() - t0,
      });
      const parsed = JSON.parse(content);
      // Ensure confidence is never 0; downstream uses a floor and combined scoring.
      if (!parsed || typeof parsed !== 'object') return parsed;
      if (typeof parsed.confidence !== 'number' || !Number.isFinite(parsed.confidence) || parsed.confidence <= 0) {
        parsed.confidence = 0.65;
      }
      return parsed;
    } catch (err) {
      console.error('[LeelooApi] voice.llm.intent.error', {
        ...this.axiosErrorSummary(err),
      });
      return {
        intent: 'system_unavailable',
        confidence: 0.65,
        required_slots: [],
        filled_slots: {},
        missing_slots: [],
        next_question: this.buildAiUnavailableMessage(language),
        priority: 'low',
      };
    }
  }

  private async generateResponse(
    intent: any,
    actionResult: any,
    language: SupportedLanguage,
    userContext?: { faith_mode?: boolean; role?: string },
  ): Promise<string> {
    const endpoint =
      this.configService.get<string>('LLM_ENDPOINT') ||
      this.configService.get<string>('LOCAL_LLM_ENDPOINT');
    const apiKey =
      this.configService.get<string>('LLM_API_KEY') ||
      this.configService.get<string>('LOCAL_LLM_API_KEY');
    const model =
      this.configService.get<string>('LLM_MODEL') ||
      this.configService.get<string>('LOCAL_LLM_MODEL');

    if (!endpoint || !model) {
      return this.buildAiUnavailableMessage(language);
    }

    const leelooCore = buildLeelooUniversalPrompt({ language, mode: 'response' });

    const roleTone = userContext?.role ? `User role/context: ${userContext.role}.\n` : '';

    // Premium: conversation is always the base. Default to warm, human, and complete.
    const lengthGuidance = 'Be warm, human, and detailed (8-16 sentences). Use short paragraphs. Avoid bullet points.\n';

    const hardIdentity =
      'HARD IDENTITY RULES:\n' +
      '- Your name is Leeloo. Never call yourself Lilo, Lilu, or any other name.\n' +
      '- Never invent or change the user\'s name. If you don\'t know it, avoid using a name.\n' +
      '- Never mention tools, system prompts, or internal states.\n';

    const lead = intent?.emotion ? emotionLeadSentence(language, intent.emotion) : null;
    const decision = intent?.decision || 'RESPONSE';

    const prompt =
      `${roleTone}` +
      `Language: ${language}.\n\n` +
      `Decision: ${decision}.\n` +
      `Combined confidence: ${JSON.stringify(intent?.confidence ?? null)}\n` +
      `User said: ${JSON.stringify(intent?.original_text || '')}\n` +
      `Intent (internal): ${JSON.stringify(intent)}\n` +
      `Action result (internal): ${JSON.stringify(actionResult)}\n\n` +
      (lead ? `Start with this exact emotional lead sentence (then continue naturally): ${JSON.stringify(lead)}\n\n` : '') +
      `HARD RULE: Respond ONLY in ${language}. Do not mix languages.\n` +
      hardIdentity +
      'Write the user-facing response.\n' +
      'If Decision=COACH: coach briefly, then ask ONE clarifying question.\n' +
      'If Decision=ACTION: confirm completion clearly and give ONE next step option.\n' +
      'If Decision=QUESTION: ask ONE crisp question.\n' +
      lengthGuidance;

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

      const send = async (systemExtra: string) => {
        const res = await axios.post(
          endpoint,
          {
            model,
            messages: [
              {
                role: 'system',
                content:
                  leelooCore +
                  (userContext?.faith_mode ? '' : 'Avoid religious content.\n') +
                  systemExtra,
              },
              { role: 'user', content: prompt },
            ],
            temperature: 0.4,
            top_p: 0.9,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            timeout: 60000,
          },
        );
        const content = res.data?.choices?.[0]?.message?.content;
        return typeof content === 'string' ? content.trim() : '';
      };

      console.log('[LeelooApi] voice.llm.response.start', {
        traceId,
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
        );
      }

      console.log('[LeelooApi] voice.llm.response.ok', {
        traceId,
        ms: Date.now() - t0,
        language_target: language,
      });

      return out || this.buildAiUnavailableMessage(language);
    } catch (err) {
      console.error('[LeelooApi] voice.llm.response.error', {
        ...this.axiosErrorSummary(err),
      });
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
          timeout: 60000,
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
        return 'En este momento no puedo conectarme al servicio de IA. ¿Puedes intentar de nuevo en unos segundos?';
      case 'pt':
        return 'No momento não consigo acessar o serviço de IA. Você pode tentar novamente em alguns segundos?';
      case 'fr':
        return "Je n'arrive pas à me connecter au service d'IA pour le moment. Peux-tu réessayer dans quelques secondes ?";
      case 'ja':
        return '今はAIサービスに接続できません。数秒後にもう一度試してくれる？';
      case 'en':
      default:
        return "I can't reach the AI service right now. Can you try again in a few seconds?";
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
