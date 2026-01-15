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

          const res = await axios.post(url, form, {
            timeout: 120000,
            headers: {
              ...form.getHeaders(),
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
          });

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
          // Fall through to /asr
        }

        // Try whisper-asr-webservice style: POST /asr (multipart, field "audio_file")
        const url = `${base}/asr`;
        {
          const t0 = Date.now();
          console.log('[LeelooApi] voice.stt.try', { traceId, url });
        const form = new FormData();
        form.append('audio_file', audioBuffer, {
          filename: 'audio.m4a',
          contentType: 'audio/m4a',
        });
        form.append('task', 'transcribe');
        form.append('language', language);
        // request JSON response when supported
        form.append('output', 'json');

        const res = await axios.post(url, form, {
          timeout: 120000,
          headers: {
            ...form.getHeaders(),
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        });

        {
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
        }

        // If /asr returns 2xx but empty, keep trying.
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

          const res2 = await axios.post(url2, form2, {
            timeout: 120000,
            headers: {
              ...form2.getHeaders(),
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
          });

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

    let language =
      (this.profilesService.getPreferredLanguage(profile) ||
        ((userContext?.language || 'en').toLowerCase() as any) ||
        'en') as SupportedLanguage;

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
      return {
        transcription: cleanedText,
        intent: { intent: 'system_off', confidence: 1 },
        action_result: { system_on: false },
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    // Deterministic greeting/small talk gate (prevents intent bias from recent action context).
    // Only applies when we're NOT in a pending slot-filling flow.
    if (!state?.pending_intent) {
      const t = cleanedText.toLowerCase();
      const isGreeting =
        /^\s*(hola|buenas|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|hey|hello|hi|yo)\b/.test(t) ||
        /^\s*(c[oó]mo\s+est[aá]s|how\s+are\s+you)\b/.test(t);

      if (isGreeting) {
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
    }

    const lower = cleanedText.toLowerCase();
    let requestedLanguage: SupportedLanguage | null = null;
    if (lower.includes('english') || lower.includes('inglés') || lower.includes('ingles')) {
      requestedLanguage = 'en';
    } else if (lower.includes('español') || lower.includes('espanol') || lower.includes('spanish')) {
      requestedLanguage = 'es';
    } else if (lower.includes('portugu') || lower.includes('português') || lower.includes('português')) {
      requestedLanguage = 'pt';
    } else if (lower.includes('français') || lower.includes('francais') || lower.includes('french')) {
      requestedLanguage = 'fr';
    }

    if (requestedLanguage) {
      language = requestedLanguage;
      await this.profilesService.ensureProfileByClerkUserId(clerkUserId, { language });
      await this.profilesService.updateLanguage(clerkUserId, language);
      await this.profilesService.setConversationState(clerkUserId, {
        preferred_language: language,
      });
      const responseText =
        language === 'en'
          ? "Got it. I'll speak English from now on."
          : language === 'es'
            ? 'Listo. A partir de ahora te hablo en español.'
            : language === 'pt'
              ? 'Certo. A partir de agora vou falar em português.'
              : 'D’accord. Je parlerai français à partir de maintenant.';
      const audioUrl = await this.generateTTS(responseText, language);
      return {
        transcription: cleanedText,
        intent: { intent: 'set_language', confidence: 1, language },
        action_result: { preferred_language: language },
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    // If we have a pending multi-turn flow, treat this message as the answer for the next missing slot.
    if (state?.pending_intent && cleanedText) {
      const pendingIntent = state.pending_intent;
      const pendingSlots = state.pending_slots || {};

      const missingSlots: string[] = Array.isArray(pendingIntent?.missing_slots)
        ? pendingIntent.missing_slots
        : [];
      const slotToFill = missingSlots[0] || null;

      if (slotToFill) {
        const filled = {
          ...(pendingIntent?.filled_slots || {}),
          ...(pendingSlots?.filled_slots || {}),
          [slotToFill]: cleanedText,
        };

        const newMissing = missingSlots.slice(1);
        const updatedIntent = {
          ...pendingIntent,
          filled_slots: filled,
          missing_slots: newMissing,
        };

        if (newMissing.length > 0) {
          const responseText = pendingIntent?.next_question || this.buildMissingTaskTitleMessage(language);
          const audioUrl = await this.generateTTS(responseText, language);
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

        // No more missing slots: execute the pending intent now.
        await this.profilesService.clearConversationState(clerkUserId);

        // Cognitive pipeline (post-slot-fill)
        const emotion = detectEmotionHeuristic(cleanedText);
        const slotConfidence = computeSlotConfidence({
          intentName: String(updatedIntent?.intent || ''),
          filled: updatedIntent?.filled_slots || {},
          missing: [],
        });
        const confidence = computeConfidence({
          intent_confidence_raw: updatedIntent?.confidence,
          slot_confidence: slotConfidence,
          floor: 0.65,
        });
        const decision = decide({
          intentName: String(updatedIntent?.intent || ''),
          missingSlots: [],
          confidence,
          last_intent: state?.last_intent || null,
          last_question: state?.last_question || null,
          last_action: state?.last_action || null,
        });

        // Emotion can downgrade ACTION to COACH when intense.
        const emotionOverridesAction =
          emotion && emotion.intensity >= 0.6 &&
          ['stressed', 'confused', 'sad', 'frustrated', 'anxious', 'angry'].includes(emotion.label);

        let executed: any = null;
        if (decision.decision === 'ACTION' && !emotionOverridesAction) {
          executed = await this.executeIntent(clerkUserId, updatedIntent, language);
          await this.profilesService.setConversationState(clerkUserId, {
            preferred_language: language,
            last_intent: String(updatedIntent?.intent || ''),
            last_action: String(updatedIntent?.intent || ''),
          });
        }

        const responseText = await this.generateResponse(
          {
            ...updatedIntent,
            confidence: confidence.combined_confidence,
            emotion,
            decision: emotionOverridesAction && decision.decision === 'ACTION' ? 'COACH' : decision.decision,
            original_text: cleanedText,
          },
          executed,
          language,
          userContext,
        );
        const audioUrl = await this.generateTTS(responseText, language);
        return {
          transcription: cleanedText,
          intent: updatedIntent,
          action_result: executed,
          task_id: (executed as any)?.id || null,
          response_text: responseText,
          response_audio_url: audioUrl,
        };
      }
    }

    await this.profilesService.ensureProfileByClerkUserId(clerkUserId, { language });

    if (!cleanedText) {
      const responseText = this.buildSttFailureMessage(language);
      const audioUrl = await this.generateTTS(responseText, language);

      return {
        transcription: '',
        intent: null,
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
    const intent = await this.extractIntent(cleanedText, fullContext, language);

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
              ? '¿A qué correo quieres que lo envíe?'
              : '¿Qué quieres que diga el correo? Dímelo tal cual y lo mando.';
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
      await this.profilesService.setConversationState(clerkUserId, {
        preferred_language: language,
        pending_intent: intent,
        pending_slots: { filled_slots: intent?.filled_slots || {} },
        next_question: responseText,
        last_question: responseText,
        last_intent: String(intent?.intent || ''),
      });
      return {
        transcription: cleanedText,
        intent: { ...intent, emotion, confidence: confidence.combined_confidence, decision: 'QUESTION', original_text: cleanedText },
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
      await this.profilesService.setConversationState(clerkUserId, {
        preferred_language: language,
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
      return {
        transcription: cleanedText,
        intent: { ...intent, emotion, confidence: confidence.combined_confidence, decision: 'IGNORE', original_text: cleanedText },
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    // ACTION path
    const actionResult = await this.executeIntent(clerkUserId, intent, language);
    await this.profilesService.setConversationState(clerkUserId, {
      preferred_language: language,
      last_intent: String(intent?.intent || ''),
      last_action: String(intent?.intent || ''),
      last_question: undefined,
    });

    const responseText = await this.generateResponse(
      { ...intent, emotion, confidence: confidence.combined_confidence, decision: 'ACTION', original_text: cleanedText },
      actionResult,
      language,
      userContext,
    );
    const audioUrl = await this.generateTTS(responseText, language);

    try {
      await this.memoriesService.createMemory(clerkUserId, 'other', `turn_${Date.now()}`, {
        language,
        user: cleanedText,
        assistant: responseText,
        intent: intent?.intent,
        task_id: (actionResult as any)?.id || null,
      });
    } catch (err) {
      console.warn('[LeelooApi] conversation memory save failed', String(err));
    }

    return {
      transcription: cleanedText,
      intent,
      action_result: actionResult,
      task_id: (actionResult as any)?.id || null,
      response_text: responseText,
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
        confidence: 0,
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
      '  "intent": "schedule_meeting" | "create_task" | "reminder" | "send_email" | "emotional_support" | "query",\n' +
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
      'Write the user-facing response.\n' +
      'If Decision=COACH: coach briefly, then ask ONE clarifying question.\n' +
      'If Decision=ACTION: confirm completion clearly and give ONE next step option.\n' +
      'If Decision=QUESTION: ask ONE crisp question.\n' +
      'Be concise but meaningful (2-6 short sentences).';

    try {
      const traceId = this.createTraceId('llm_resp');
      const t0 = Date.now();
      const res = await axios.post(
        endpoint,
        {
          model,
          messages: [
            {
              role: 'system',
              content: leelooCore + (userContext?.faith_mode ? '' : 'Avoid religious content.\n'),
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
      if (!content) {
        throw new Error('No content from LLM');
      }

      console.log('[LeelooApi] voice.llm.response.ok', {
        traceId,
        ms: Date.now() - t0,
      });
      return content;
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
