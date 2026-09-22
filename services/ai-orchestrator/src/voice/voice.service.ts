import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import {
  LEELOO_SYSTEM_PROMPT,
  LEELOO_SYSTEM_PROMPT_VERSION,
  LEELOO_PERSONALITIES,
  PERSONALITY_CONFIRM,
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
  private readonly logger = new Logger(VoiceService.name);

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
    timezone?: string;
    latitude?: number;
    longitude?: number;
    city?: string;
    country?: string;
    pending_event_id?: string;
    pending_attendee_name?: string;
    conversation_history?: string;
  }) {
    const language = this.normalizeLanguage(input.language);

    const t0 = Date.now();
    const ms = () => Date.now() - t0;

    const inputMethod: 'voice' | 'text' = input.text ? 'text' : 'voice';
    let transcription = '';
    try {
      transcription = input.text
        ? String(input.text)
        : await this.openAiQueue.transcribe({
            userId: input.userId,
            filename: input.audio?.originalname || 'audio.webm',
            bytes: input.audio?.buffer || Buffer.from(''),
            language,
          });
      transcription = VoiceService.normalizeEmailInTranscript(transcription);
      this.logger.log(`[PIPE] stt done +${ms()}ms input_method=${inputMethod} — "${transcription.slice(0, 60)}"`);
    } catch (err: any) {
      this.logger.error(`[PIPE] stt FAILED +${ms()}ms input_method=${inputMethod} — ${(err as any)?.message}`);
      return {
        ok: false,
        input_method: inputMethod,
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

    // Fire memory + userCtx in parallel — saves 3s when DB is slow (sequential before)
    const validPersonalities: LeelooPersonality[] = [
      'default', 'christian', 'coach', 'mentor', 'business', 'counselor', 'faith', 'motivation', 'nurturing',
    ];
    // Personality may arrive as a comma-separated list (multi-select UI: "coach,mentor").
    // Take the first valid value; "balanced" maps to "default" (no dedicated TTS preset yet).
    const rawPersonality = String(input.personality || '').trim();
    const firstPersonality = rawPersonality.split(',')[0].trim().replace(/^balanced$/, 'default');
    const personality: LeelooPersonality =
      validPersonalities.includes(firstPersonality as LeelooPersonality)
        ? (firstPersonality as LeelooPersonality)
        : 'default';

    const hour = new Date().getHours();
    const timeOfDay =
      hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : hour < 21 ? 'evening' : 'night';

    this.logger.log(`[PIPE] memory+userCtx start +${ms()}ms`);
    const [memories, userCtx] = await Promise.all([
      this.openAiQueue.fetchMemoryContext({
        userId: input.userId,
        query: transcription,
        limit: 5,
      }).catch(() => {
        this.logger.warn(`[PIPE] memory failed — continuing without`);
        return '';
      }),
      Promise.race([
        this.openAiQueue.fetchUserContext(input.userId),
        new Promise<{ todayTasks: string[]; upcomingEvents: string[]; pendingApprovals: number }>(
          (resolve) => setTimeout(() => {
            this.logger.warn(`[PIPE] userCtx timeout after 3s — skipping`);
            resolve({ todayTasks: [], upcomingEvents: [], pendingApprovals: 0 });
          }, 3_000),
        ),
      ]).catch(() => ({ todayTasks: [], upcomingEvents: [], pendingApprovals: 0 })),
    ]);
    this.logger.log(`[PIPE] memory+userCtx done +${ms()}ms — mem=${String(memories).length}chars`);

    // Build system prompt: base JSON schema + personality-specific voice description.
    // LEELOO_SYSTEM_PROMPT hardcodes 'default' personality — inject the active one on top
    // so Claude adopts the user's chosen mode (coach, christian, counselor, etc.) correctly.
    const safeName = (input.userName || '').trim() || 'amigo';
    const personalityDesc = (LEELOO_PERSONALITIES[personality] ?? LEELOO_PERSONALITIES.default)
      .replace(/\{\{userName\}\}/g, safeName)
      .trim();
    const systemPrompt =
      LEELOO_SYSTEM_PROMPT.replace(/__USER_NAME__/g, safeName) +
      (personality !== 'default'
        ? `\n\nMODO ACTIVO — ${personality.toUpperCase()}:\n${personalityDesc}`
        : '');
    const userTimezone = (input as any).timezone || 'America/Bogota';
    const now = new Date();
    const localTime = now.toLocaleString('en-US', {
      timeZone: userTimezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const todayLocal = now.toLocaleDateString('en-CA', { timeZone: userTimezone }); // YYYY-MM-DD
    const ctxLines = [
      `TODAY: ${todayLocal}`,
      `CURRENT_LOCAL_TIME: ${localTime}`,
      `USER_TIMEZONE: ${userTimezone}`,
      `DAY_OF_WEEK: ${now.toLocaleDateString('en-US', { weekday: 'long', timeZone: userTimezone })}`,
      ...(input.userName ? [`USER_NAME: ${input.userName}`] : []),
      ...(() => {
        if (input.latitude != null && input.longitude != null) {
          const cityStr = [input.city, input.country].filter(Boolean).join(', ');
          return [`USER_LOCATION: ${cityStr || 'unknown city'} (${input.latitude}, ${input.longitude})`];
        }
        if (input.city) return [`USER_LOCATION: ${[input.city, input.country].filter(Boolean).join(', ')}`];
        return [];
      })(),
      `TIME_OF_DAY: ${timeOfDay}`,
      `PERSONALITY: ${personality}`,
      `LANGUAGE: ${language}`,
      ...(userCtx.todayTasks.length ? [`TODAY_TASKS: ${userCtx.todayTasks.slice(0, 3).join('; ')}`] : []),
      ...(userCtx.upcomingEvents.length ? [`UPCOMING_EVENTS: ${userCtx.upcomingEvents.slice(0, 3).join('; ')}`] : []),
      ...(userCtx.pendingApprovals > 0 ? [`PENDING_APPROVALS: ${userCtx.pendingApprovals}`] : []),
    ].join('\n');

    // Conversation history — gives Claude context of the current voice session.
    // This is what makes Leeloo feel like a continuous conversation, not isolated queries.
    const historyBlock = input.conversation_history
      ? `\n\nRECENT_CONVERSATION (most recent last — use for context, do not repeat):\n${input.conversation_history}`
      : '';

    const memoryContext = ctxLines + historyBlock + (memories ? '\n\n' + memories : '');

    let intent: IntentResult;
    try {
      this.logger.log(`[PIPE] claude start +${ms()}ms`);
      intent = await this.openAiQueue.extractIntent({
        userId: input.userId,
        language,
        transcription,
        memoryContext: memoryContext,
        systemPrompt,
        systemPromptVersion: LEELOO_SYSTEM_PROMPT_VERSION,
      });
      this.logger.log(`[PIPE] claude done +${ms()}ms — intent=${intent?.intent}`);
    } catch (err: any) {
      this.logger.error(`[PIPE] claude FAILED +${ms()}ms — ${(err as any)?.message}`);
      intent = {
        intent: 'chat',
        confidence: 0.1,
        language,
        slots: {},
        assistant_text: this.fallbackText(language, err),
      };
    }

    this.logger.log(`[PIPE] action start +${ms()}ms — intent=${intent?.intent}`);

    // Parallel TTS optimisation: for intents where assistant_text is already final,
    // start TTS while the action dispatches. Saves 0.5-1.5s on every non-confirmation turn.
    const canParallelTts =
      VoiceService.PARALLEL_TTS_INTENTS.has(intent.intent) &&
      Boolean(intent.assistant_text) &&
      !intent.needs_confirmation &&
      !input.confirmation;

    const ttsEarlyPromise: Promise<string | null> = canParallelTts
      ? this.safeTts({ userId: input.userId, text: intent.assistant_text, personality })
      : Promise.resolve(null);

    const [actionResult, earlyTtsAudio] = await Promise.all([
      this.dispatchAction({
        intent,
        userId: input.userId,
        authorization: input.authorization,
        confirmation: input.confirmation,
        pendingEventId: input.pending_event_id,
        pendingAttendeeName: input.pending_attendee_name,
        language,
        latitude: input.latitude,
        longitude: input.longitude,
        city: input.city,
        country: input.country,
      }),
      ttsEarlyPromise,
    ]);
    this.logger.log(`[PIPE] action done +${ms()}ms — parallelTts=${canParallelTts}`);

    let assistantText = this.buildAssistantText(intent, actionResult, personality);

    // Personality-aware agenda brief — override static text with real formatted data
    if (intent.intent === 'agenda_today' && actionResult?._agendaData) {
      assistantText = this.formatAgendaForVoice(
        actionResult._agendaData,
        personality,
        language,
        input.userName || '',
      );
    }

    // Web search — replace placeholder with actual search results
    if (intent.intent === 'web_search' && actionResult?._searchSummary) {
      assistantText = String(actionResult._searchSummary);
    }

    // Walmart search — replace placeholder with product results summary
    if (intent.intent === 'search_walmart' && actionResult?._searchSummary) {
      assistantText = String(actionResult._searchSummary);
    }

    // Weather — replace placeholder with real weather data
    if (intent.intent === 'get_weather') {
      if (actionResult?._weatherSummary) {
        assistantText = String(actionResult._weatherSummary);
      } else if (actionResult?._searchSummary) {
        assistantText = String(actionResult._searchSummary);
      } else if (actionResult?._weatherMissing) {
        assistantText = language === 'es' ? '¿Para qué ciudad quieres el clima?' : 'Which city should I check the weather for?';
      }
    }

    // Agenda week — format events list for voice
    if (intent.intent === 'agenda_week' && actionResult?.ok && actionResult?.data) {
      const events: any[] = Array.isArray(actionResult.data) ? actionResult.data : (actionResult.data?.data || []);
      if (!events.length) {
        assistantText = language === 'es' ? 'No tienes eventos esta semana.' : 'You have no events this week.';
      } else {
        const lines = events.slice(0, 5).map((e: any) => {
          const d = new Date(e.start_at || e.date || '');
          const day = d.toLocaleDateString(language === 'es' ? 'es-CO' : 'en-US', { weekday: 'long', month: 'short', day: 'numeric' });
          return `${day}: ${e.title || e.summary}`;
        });
        assistantText = language === 'es'
          ? `Esta semana tienes: ${lines.join('. ')}.`
          : `This week you have: ${lines.join('. ')}.`;
      }
    }

    // Family check — format family members for voice
    if (intent.intent === 'check_family' && actionResult?.ok && actionResult?.data) {
      const members: any[] = Array.isArray(actionResult.data) ? actionResult.data : (actionResult.data?.data || []);
      if (!members.length) {
        assistantText = language === 'es' ? 'No tienes miembros de familia registrados aún.' : 'No family members registered yet.';
      } else {
        const names = members.map((m: any) => m.name || m.member_name).filter(Boolean).join(', ');
        assistantText = language === 'es'
          ? `Tu familia: ${names}.`
          : `Your family: ${names}.`;
      }
    }

    const needsConfirmation = Boolean(intent?.needs_confirmation);
    if (needsConfirmation && !input.confirmation) {
      const ttsAudioBase64 = await this.safeTts({
        userId: input.userId,
        text: assistantText,
        personality,
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
      const ttsAudioBase64 = await this.safeTts({ userId: input.userId, text: cancelText, personality });
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
        latitude: input.latitude,
        longitude: input.longitude,
        city: input.city,
        country: input.country,
      });
      const confirmedText = this.buildAssistantText(intent, confirmedAction, personality);
      const ttsAudioBase64 = await this.safeTts({ userId: input.userId, text: confirmedText, personality });
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
      const ttsAudioBase64 = await this.safeTts({ userId: input.userId, text: askText, personality });
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
      const ttsAudioBase64 = await this.safeTts({ userId: input.userId, text: askText, personality });
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

    // Reuse parallel-generated TTS if text is unchanged; otherwise generate fresh.
    let ttsAudioBase64: string | null;
    if (earlyTtsAudio && assistantText === intent.assistant_text) {
      ttsAudioBase64 = earlyTtsAudio;
      this.logger.log(`[PIPE] tts reused (parallel) +${ms()}ms`);
    } else {
      this.logger.log(`[PIPE] tts start +${ms()}ms — ${assistantText.length} chars`);
      ttsAudioBase64 = await this.safeTts({ userId: input.userId, text: assistantText, personality });
      this.logger.log(`[PIPE] tts done +${ms()}ms — audio=${ttsAudioBase64 ? 'ok' : 'NULL (ElevenLabs failed)'}`);
    }

    // Persist this exchange so Leeloo remembers it in future sessions
    this.saveTurnFireAndForget({
      authorization: input.authorization,
      transcription,
      assistantText,
      language,
    });

    return {
      ok: true,
      input_method: inputMethod,
      status: 'ok',
      ...(actionResult?.call_emergency ? { call_emergency: true, emergency_number: actionResult.emergency_number } : {}),
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
    const lang = String(language || 'en').toLowerCase();
    const isEs = lang.startsWith('es');
    const isPt = lang.startsWith('pt');
    const isFr = lang.startsWith('fr');
    const isEn = !isEs && !isPt && !isFr;

    const tLocale = isEs ? 'es-CO' : isPt ? 'pt-BR' : isFr ? 'fr-FR' : 'en-US';
    const fallbackName = isEs || isPt ? 'amiga' : isFr ? 'amie' : '';
    const name = ((userName || '').split(' ')[0] || fallbackName);

    const events: any[] = Array.isArray(data?.events) ? data.events : [];
    const tasks: any[] = Array.isArray(data?.tasks) ? data.tasks : [];
    const now = data?.now ? new Date(data.now) : new Date();

    const formatTime = (iso: string) => {
      try {
        return new Date(iso).toLocaleTimeString(tLocale, {
          hour: '2-digit', minute: '2-digit', hour12: !isFr,
        });
      } catch { return ''; }
    };

    const upcomingEvents = events
      .filter((e) => e.start_at && new Date(e.start_at).getTime() >= now.getTime() - 30 * 60 * 1000)
      .slice(0, 3);

    const pendingTasks = tasks
      .filter((t: any) => t.status === 'pending' || t.status === 'in_progress')
      .slice(0, 3);

    const totalEvents = events.length;
    const totalTasks = tasks.filter((t: any) => t.status === 'pending' || t.status === 'in_progress').length;
    const hasNothing = totalEvents === 0 && totalTasks === 0;

    if (hasNothing) {
      if (isEn) {
        const empty: Record<string, string> = {
          christian: `Good morning${name ? `, ${name}` : ''}! Your day is completely free. Use this time to rest and recharge. God has something special for you today.`,
          coach: `${name ? `${name}, your` : 'Your'} calendar is clear! This is the perfect moment to work on that project you've been putting off. What's your most important next step?`,
          business: `${name ? `${name}, n` : 'N'}o meetings today. Ideal day for strategy and deep work. What initiative are you advancing?`,
          counselor: `${name ? `${name}, your` : 'Your'} day is wide open. That's a gift. How do you want to use it for yourself?`,
          mentor: `${name ? `${name}, n` : 'N'}o external commitments today. Free days are for building what matters. What goal are you moving forward?`,
          faith: `${name ? `${name}, the` : 'The'} day is open. Every hour is a gift. What will you do with it?`,
          motivation: `${name ? `${name}!` : 'Hey!'} Clear day — no limits. This is your moment. What are we going after today?`,
          nurturing: `Good morning${name ? `, ${name}` : ''}. A free day — please use some of it just for you. You give so much. Today, receive a little too.`,
          default: `${name ? `Hi ${name}!` : 'Hi!'} Your calendar is clear today. The day is yours!`,
        };
        return empty[personality] ?? empty.default;
      }
      if (isPt) {
        const empty: Record<string, string> = {
          default: `${name ? `Olá ${name}!` : 'Olá!'} Você tem o dia livre hoje. O dia é seu!`,
        };
        return empty[personality] ?? empty.default;
      }
      // Spanish (default)
      const empty: Record<string, string> = {
        christian: `¡Buenos días${name ? `, ${name}` : ''}! Tienes el día libre. Usa este tiempo para descansar y recargar energía. Dios tiene algo especial para ti hoy.`,
        coach: `¡${name ? `${name}, tienes` : 'Tienes'} el calendario libre! Es el momento perfecto para trabajar en ese proyecto que has estado postergando. ¿Cuál es tu próximo paso más importante?`,
        business: `${name ? `${name}, sin` : 'Sin'} reuniones programadas hoy. Día ideal para estrategia y trabajo profundo. ¿Qué iniciativa avanzas?`,
        counselor: `${name ? `${name}, hoy tienes` : 'Hoy tienes'} el día abierto. Eso es un regalo. ¿Cómo quieres usarlo para ti misma?`,
        mentor: `${name ? `${name}, sin` : 'Sin'} compromisos externos hoy. Los días libres son para construir lo que importa. ¿Qué meta avanzas?`,
        faith: `${name ? `${name}, el` : 'El'} día está abierto. Cada hora es un regalo. ¿Qué harás con ella?`,
        motivation: `¡${name ? `${name}!` : 'Oye!'} Día libre — sin límites. Este es tu momento. ¿Qué vamos a conquistar hoy?`,
        nurturing: `Buenos días${name ? `, ${name}` : ''}. Tienes el día libre — usa algo de ese tiempo para ti. Das tanto. Hoy, recibe un poco también.`,
        default: `${name ? `Hola ${name},` : '¡Hola!'} hoy tienes el calendario libre. ¡El día es tuyo!`,
      };
      return empty[personality] ?? empty.default;
    }

    // Build event/task lines
    const eventLines = upcomingEvents.map((e: any) => {
      const at = e.start_at
        ? (isEn ? ` at ${formatTime(e.start_at)}` : isPt ? ` às ${formatTime(e.start_at)}` : ` a las ${formatTime(e.start_at)}`)
        : '';
      const loc = e.location ? (isEn ? ` at ${e.location}` : ` en ${e.location}`) : '';
      return `${e.title}${at}${loc}`;
    });
    const taskLines = pendingTasks.map((t: any) => t.title);

    const evLabel  = isEn ? 'Events' : isPt ? 'Eventos' : 'Eventos';
    const taskLabel = isEn ? 'Tasks' : isPt ? 'Tarefas' : 'Tareas';
    const listParts = [
      ...(eventLines.length ? [`${evLabel}: ${eventLines.join(', ')}`] : []),
      ...(taskLines.length  ? [`${taskLabel}: ${taskLines.join(', ')}`] : []),
    ];
    const listLine = listParts.join('. ');

    if (isEn) {
      const evPart  = totalEvents > 0 ? `${totalEvents} event${totalEvents > 1 ? 's' : ''}` : '';
      const tskPart = totalTasks > 0 ? `${totalTasks} task${totalTasks > 1 ? 's' : ''}` : '';
      const summary = [evPart, tskPart].filter(Boolean).join(' and ');
      const n = name ? `${name}, ` : '';
      const prefixes: Record<string, string> = {
        christian: `Good morning${name ? `, ${name}` : ''}. You have ${summary} today. May God guide each one. `,
        coach: `Let's go${name ? `, ${name}` : ''}! You have ${summary} today. Full focus. `,
        business: `${n}today's briefing: ${summary}. `,
        counselor: `${n}let's look at your day together. You have ${summary}. `,
        mentor: `${n}today you have ${summary}. May each one bring you closer to your goals. `,
        faith: `${n}today you have ${summary}. Every commitment is a purpose. `,
        motivation: `${name ? `${name}!` : 'Hey!'} You have ${summary} today. Let's make every single one count. `,
        nurturing: `${n}today you have ${summary}. Let's make sure you take care of yourself in between. `,
        default: `${name ? `Hi ${name},` : 'Hi!'} for today you have ${summary}. `,
      };
      const suffix: Record<string, string> = {
        coach: ' Which one are we starting with?',
        business: ' Would you like me to prepare something for the first meeting?',
        counselor: ' How do you feel looking at them?',
        motivation: ' Which one lights you up the most?',
        nurturing: ' Remember to drink water and breathe between them.',
        default: '',
      };
      const prefix = prefixes[personality] ?? prefixes.default;
      const end = suffix[personality] ?? suffix.default;
      return `${prefix}${listLine}.${end}`;
    }

    // Spanish / Portuguese / French (default to Spanish)
    const evPartEs  = totalEvents > 0 ? `${totalEvents} evento${totalEvents > 1 ? 's' : ''}` : '';
    const tskPartEs = totalTasks > 0 ? `${totalTasks} tarea${totalTasks > 1 ? 's' : ''}` : '';
    const summaryEs = [evPartEs, tskPartEs].filter(Boolean).join(' y ');
    const prefixesEs: Record<string, string> = {
      christian: `Buenos días${name ? `, ${name}` : ''}. Hoy tienes ${summaryEs}. Que Dios guíe cada uno. `,
      coach: `¡Vamos${name ? ` ${name}` : ''}! Son ${summaryEs} para hoy. Foco total. `,
      business: `${name ? `${name}, ` : ''}briefing de hoy: ${summaryEs}. `,
      counselor: `${name ? `${name}, ` : ''}veamos tu día${name ? '' : ' juntos'}. Tienes ${summaryEs}. `,
      mentor: `${name ? `${name}, ` : ''}hoy son ${summaryEs}. Que cada uno te acerque a tus metas. `,
      faith: `${name ? `${name}, ` : ''}hoy tienes ${summaryEs}. Cada compromiso es un propósito. `,
      motivation: `¡${name ? `${name}!` : 'Hey!'} Son ${summaryEs} para hoy. Hagamos que cada uno cuente. `,
      nurturing: `${name ? `${name}, ` : ''}hoy tienes ${summaryEs}. Asegurémonos de que te cuides entre uno y otro. `,
      default: `${name ? `Hola ${name},` : '¡Hola!'} para hoy tienes ${summaryEs}. `,
    };
    const suffixEs: Record<string, string> = {
      coach: ' ¿Por cuál arrancamos?',
      business: ' ¿Quieres que prepare algo para la primera reunión?',
      counselor: ' ¿Cómo te sientes al verlos?',
      motivation: ' ¿Cuál te emociona más?',
      nurturing: ' Recuerda tomar agua y respirar entre cada uno.',
      default: '',
    };
    const prefix = prefixesEs[personality] ?? prefixesEs.default;
    const end = suffixEs[personality] ?? suffixEs.default;
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

  // ElevenLabs voice parameter presets per personality.
  // Each personality has a distinct acoustic feel while sharing the same voice ID.
  private static readonly PERSONALITY_TTS: Record<string, {
    stability: number; similarityBoost: number; style: number;
  }> = {
    counselor:  { stability: 0.75, similarityBoost: 0.85, style: 0.08 }, // slow, warm, therapeutic
    coach:      { stability: 0.28, similarityBoost: 0.80, style: 0.72 }, // energetic, dynamic
    business:   { stability: 0.65, similarityBoost: 0.85, style: 0.12 }, // professional, clear
    christian:  { stability: 0.62, similarityBoost: 0.82, style: 0.22 }, // serene, gentle
    mentor:     { stability: 0.52, similarityBoost: 0.80, style: 0.38 }, // thoughtful, measured
    faith:      { stability: 0.60, similarityBoost: 0.82, style: 0.20 }, // warm, reverential
    motivation: { stability: 0.22, similarityBoost: 0.82, style: 0.85 }, // high energy, belief-driven
    nurturing:  { stability: 0.80, similarityBoost: 0.88, style: 0.05 }, // softest, most tender
    default:    { stability: 0.45, similarityBoost: 0.80, style: 0.35 }, // balanced
  };

  // Intents safe for parallel TTS: assistant_text is final regardless of action outcome.
  // EXCLUDED: create_task, create_reminder, create_alarm, create_event — these must
  // confirm the backend action succeeded BEFORE speaking "Done!". If the POST fails,
  // the user hears a false success. TTS waits for actionResult for these intents.
  private static readonly PARALLEL_TTS_INTENTS = new Set([
    'chat', 'emotional_support', 'medical_query', 'save_memory', 'set_language',
    'complete_task', 'set_goal',
    'daily_verse', 'suggest_meal', 'get_recipe', 'recommend_restaurant',
    'play_media', 'make_call', 'school_email_check',
    'add_to_shopping_list', 'view_shopping_list',
    'add_family_member', 'assign_to_family_member', 'list_goals', 'check_goals',
    'set_personality', 'update_profile',
    'search_walmart',
    // Safety intents — response is the action itself, no backend call needed
    'crisis_support', 'illegal_request_declined', 'call_emergency',
  ]);

  private async safeTts(input: { userId: string; text: string; personality?: string }) {
    try {
      const preset = VoiceService.PERSONALITY_TTS[input.personality ?? 'default']
        ?? VoiceService.PERSONALITY_TTS.default;
      const result = await this.ttsFactory.synthesize(input.text, {
        stability: preset.stability,
        similarityBoost: preset.similarityBoost,
        style: preset.style,
        useSpeakerBoost: true,
      });
      return result.audio.toString('base64');
    } catch (err: any) {
      this.logger.error(
        `[TTS] safeTts failed — provider=${process.env.TTS_PROVIDER ?? 'unknown'} voiceId=${process.env.ELEVENLABS_VOICE_ID ?? 'unset'} error=${err?.message ?? String(err)}`,
      );
      return null;
    }
  }

  // Repairs email addresses garbled by STT (Groq/Whisper merges tokens around "@").
  // e.g. "magalva arroba gmail punto com" → "magalva@gmail.com"
  //      "john at gmail dot com"          → "john@gmail.com"
  private static normalizeEmailInTranscript(text: string): string {
    // Replace spoken "@" variants with actual @
    let t = text
      .replace(/\barroba\b/gi, '@')
      .replace(/\bat sign\b/gi, '@')
      .replace(/\b(?:at)\b(?=\s+\w+\s+(?:punto|dot|\.)\s*(?:com|net|org|io|co|edu|gov|us|es|mx|br|fr|de))/gi, '@');

    // Replace spoken "." variants inside what looks like an email context
    t = t.replace(
      /([a-z0-9@._+-]+)\s+(?:punto|dot|period)\s+([a-z]{2,6})/gi,
      (_m, left: string, tld: string) => `${left}.${tld}`,
    );

    // Collapse spaces around "@" if surrounded by word chars (STT sometimes splits tokens)
    t = t.replace(/([a-z0-9._+-]+)\s*@\s*([a-z0-9._+-]+)/gi, '$1@$2');

    return t;
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

  async detectWakeWord(input: {
    userId: string;
    audio: Express.Multer.File;
    language?: string;
  }): Promise<boolean> {
    const WAKE_KEYWORDS = [
      // Core phonetic variants of "Leeloo" (/liːluː/)
      'leeloo', 'leelo', 'leelu', 'liloo', 'lilu', 'lilo', 'lyloo', 'lylo', 'lylu',
      'lelu', 'leelu', 'lelou', 'lielo', 'lelo', 'leloo', 'leolu',
      'leo', 'liou',
      // Two-word STT splits
      'lee loo', 'lee lu', 'li loo', 'li lu', 'lee lo',
      // Groq/Whisper confirmed variants from production logs
      'lilou', 'leelou', 'leeloue',
      // With trigger words — EN
      'hey leeloo', 'hey leelo', 'hey lilu', 'hey lelu', 'hey lilou', 'hey leo',
      'hi leeloo', 'hi lilou', 'hi lilu', 'hi lelo', 'hi leo',
      'hello leeloo', 'hello lilu', 'hello lilou',
      'ok leeloo', 'okay leeloo', 'ok lilu', 'ok leo',
      // With trigger words — ES
      'oye leeloo', 'oye lelu', 'oye lilu', 'oye lilou', 'oye leo', 'oye lilo',
      'hola leeloo', 'hola lelu', 'hola lilou', 'hola lilu', 'hola lilo',
      'ey leeloo', 'ey lelu', 'ey lilu', 'ey lilou',
      // With trigger words — PT
      'oi leeloo', 'oi lilu', 'oi lilou', 'oi leo',
      // With trigger words — FR
      'hé leeloo', 'hé lilu', 'hé lilou', 'he leeloo', 'he lilu', 'he lilou',
    ];
    try {
      const text = await this.openAiQueue.transcribe({
        userId: input.userId,
        filename: input.audio.originalname || 'wake.m4a',
        bytes: input.audio.buffer,
        language: input.language,
      });
      const lower = text.toLowerCase().trim();
      this.logger.debug(`[WAKE] transcription="${lower.slice(0, 60)}"`);
      return WAKE_KEYWORDS.some((kw) => lower.includes(kw));
    } catch (err: any) {
      const msg = String(err?.message ?? err ?? '');
      // Propagate rate limit as HTTP 429 so the mobile client can back off
      if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || err?.status === 429) {
        this.logger.warn('[WAKE] OpenAI rate limit — returning 429 to client');
        throw new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
      }
      this.logger.warn(`[WAKE] detectWakeWord error — ${msg}`);
      return false;
    }
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

  private buildAssistantText(intent: IntentResult, actionResult: any, personality?: string) {
    // Action failed — always speak the error, never the success text.
    if (actionResult?.ok === false && actionResult?.fallback_text) {
      return String(actionResult.fallback_text);
    }

    const base = String(intent?.assistant_text || '').trim();
    if (base) return base;

    // Personality-aware natural fallbacks — used only when Claude returns empty assistant_text
    const p = (personality ?? 'default') as LeelooPersonality;
    const pcAll = PERSONALITY_CONFIRM[p] ?? PERSONALITY_CONFIRM.default;
    const lang = String(intent?.language || 'es').toLowerCase();
    const langKey = lang.startsWith('en') ? 'en' : lang.startsWith('pt') ? 'pt' : lang.startsWith('fr') ? 'fr' : 'es';
    const pc = pcAll[langKey];

    // Helpers for multilingual static strings not in PERSONALITY_CONFIRM
    const t = (es: string, en: string, pt: string, fr: string) =>
      langKey === 'en' ? en : langKey === 'pt' ? pt : langKey === 'fr' ? fr : es;

    const i = String(intent?.intent || '').trim();
    if (i === 'create_task') return pc.task_created;
    if (i === 'complete_task') return pc.task_done;
    if (i === 'create_reminder') return pc.reminder_set;
    if (i === 'create_event') return pc.event_created;
    if (i === 'save_memory') return pc.saved;
    if (i === 'send_email') return t('¡Listo! Correo enviado.', 'Done! Email sent.', 'Pronto! E-mail enviado.', 'Fait ! E-mail envoyé.');
    if (i === 'agenda_today') return t('Aquí está tu agenda de hoy.', 'Here is your agenda for today.', 'Aqui está sua agenda de hoje.', 'Voici ton agenda du jour.');
    if (i === 'update_task') return actionResult?.data?.title
      ? t(`¡Listo! Actualicé: "${actionResult.data.title}".`, `Done! Updated: "${actionResult.data.title}".`, `Pronto! Atualizei: "${actionResult.data.title}".`, `Fait ! Mis à jour : "${actionResult.data.title}".`)
      : t('¡Tarea actualizada!', 'Done! Task updated.', 'Tarefa atualizada!', 'Tâche mise à jour !');
    if (i === 'delete_task') return actionResult?.data?.title
      ? t(`Listo, eliminé "${actionResult.data.title}".`, `Done, I removed "${actionResult.data.title}".`, `Pronto, removi "${actionResult.data.title}".`, `Fait, j'ai supprimé "${actionResult.data.title}".`)
      : t('Tarea eliminada.', 'Task deleted.', 'Tarefa excluída.', 'Tâche supprimée.');
    if (i === 'update_event') return t('¡Listo! Evento actualizado.', 'Done! Event updated.', 'Pronto! Evento atualizado.', 'Fait ! Événement mis à jour.');
    if (i === 'delete_event') return actionResult?.data?.title
      ? t(`Listo, cancelé "${actionResult.data.title}".`, `Done, I cancelled "${actionResult.data.title}".`, `Pronto, cancelei "${actionResult.data.title}".`, `Fait, j'ai annulé "${actionResult.data.title}".`)
      : t('Evento cancelado.', 'Event cancelled.', 'Evento cancelado.', 'Événement annulé.');
    if (i === 'postpone_event') return t('¡Listo! Evento pospuesto.', 'Done! Event moved.', 'Pronto! Evento adiado.', 'Fait ! Événement reporté.');
    if (i === 'set_personality') return intent?.assistant_text || t('¡Listo! Modo actualizado.', 'Got it! Mode updated.', 'Pronto! Modo atualizado.', 'C\'est fait ! Mode mis à jour.');
    if (i === 'update_profile') return t('Guardado. Ya lo tengo en mente.', 'Got it, I\'ll remember that.', 'Guardado. Já tenho em mente.', 'Noté. Je m\'en souviens.');
    if (i === 'web_search') return actionResult?._searchSummary
      ? String(actionResult._searchSummary)
      : t('Buscando eso ahora mismo...', 'Searching that right now...', 'Pesquisando isso agora...', 'Je cherche ça maintenant...');
    if (i === 'search_walmart') return actionResult?._searchSummary
      ? String(actionResult._searchSummary)
      : t('Buscando en Walmart ahora mismo...', 'Searching Walmart right now...', 'Pesquisando no Walmart agora...', 'Je cherche sur Walmart maintenant...');
    if (i === 'get_weather') return actionResult?._weatherSummary || actionResult?._searchSummary
      || t('Revisando el clima para ti...', 'Checking the weather for you...', 'Verificando o clima para você...', 'Je vérifie la météo pour toi...');
    if (i === 'set_location') return t('¡Ubicación guardada!', 'Location saved!', 'Localização salva!', 'Localisation enregistrée !');
    if (i === 'agenda_week') return t('Aquí está tu semana.', 'Here\'s your week.', 'Aqui está sua semana.', 'Voici ta semaine.');
    if (i === 'check_family') return t('Aquí está tu familia.', 'Here\'s your family.', 'Aqui está sua família.', 'Voici ta famille.');

    // Safety intents — response comes directly from Claude's assistant_text (set by the prompt rules)
    if (i === 'crisis_support') return base || t(
      'Estoy aquí contigo. Lo que sientes importa, y tú importas. ¿Estás en un lugar seguro ahora mismo? Puedes llamar a la línea de crisis si lo necesitas.',
      'I\'m here with you. What you\'re feeling matters, and you matter. Are you somewhere safe right now? You can call a crisis line if you need to.',
      'Estou aqui com você. O que você sente importa, e você importa. Você está em um lugar seguro agora? Você pode ligar para o CVV: 188.',
      'Je suis là avec toi. Ce que tu ressens compte, et tu comptes. Es-tu en sécurité en ce moment ? Tu peux appeler le 3114.',
    );
    if (i === 'illegal_request_declined') return base || t(
      'Eso no puedo ayudarte a hacer.',
      'I can\'t help with that.',
      'Não posso ajudar com isso.',
      'Je ne peux pas t\'aider avec ça.',
    );
    if (i === 'call_emergency') {
      const num = String(intent?.slots?.emergency_number || '911');
      return base || t(
        `Voy a llamar al ${num} ahora. Di "cancelar" si no es una emergencia.`,
        `I'm calling ${num} now. Say "cancel" if this is not an emergency.`,
        `Vou ligar para o ${num} agora. Diga "cancelar" se não for uma emergência.`,
        `J'appelle le ${num} maintenant. Dis "annuler" si ce n'est pas une urgence.`,
      );
    }

    if (actionResult?.fallback_text) return String(actionResult.fallback_text);
    return pc.generic_done;
  }

  private async dispatchAction(input: {
    intent: IntentResult;
    userId: string;
    authorization?: string;
    confirmation?: 'confirmed' | 'cancel';
    pendingEventId?: string;
    pendingAttendeeName?: string;
    language?: string;
    latitude?: number;
    longitude?: number;
    city?: string;
    country?: string;
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
    const lang = this.normalizeLanguage(input.language);

    try {
      if (input.intent.needs_confirmation && input.confirmation !== 'confirmed') {
        return { ok: true, deferred: true };
      }

      // Safety intents — no backend call; response is purely conversational or device-side
      if (intent === 'crisis_support' || intent === 'illegal_request_declined') {
        return { ok: true, safety: true };
      }

      if (intent === 'call_emergency') {
        const emergencyNumber = String(input.intent.slots?.emergency_number || '911').trim();
        return { ok: true, safety: true, call_emergency: true, emergency_number: emergencyNumber };
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
        const rawTo = String(slots.to || '').trim();
        // Normalize voice-dictated email: "arroba"→"@", "punto"→".", remove spaces
        const to = rawTo
          .toLowerCase()
          .replace(/\barroba\b/g, '@')
          .replace(/\bat\b/g, '@')
          .replace(/\bpunto\s+com\b/g, '.com')
          .replace(/\bdot\s+com\b/g, '.com')
          .replace(/\bpunto\s+co\b/g, '.co')
          .replace(/\bgmail\s+com\b/g, 'gmail.com')
          .replace(/\bhotmail\s+com\b/g, 'hotmail.com')
          .replace(/\byahoo\s+com\b/g, 'yahoo.com')
          .replace(/\boutlook\s+com\b/g, 'outlook.com')
          .replace(/\bpunto\b/g, '.')
          .replace(/\bdot\b/g, '.')
          .replace(/\bguion\s+bajo\b/g, '_')
          .replace(/\bguion\b/g, '-')
          .replace(/\s+/g, '')
          .replace(/\.{2,}/g, '.')
          .replace(/@{2,}/g, '@');
        const subject = String(slots.subject || '').trim();
        const body = String(slots.body || '').trim();
        const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const emailT = {
          en: {
            no_to:      'Who should I send the email to? Please give me the exact email address.',
            bad_email:  (addr: string) => `"${addr}" doesn't look like a valid email. Could you spell it out?`,
            no_subject: 'What is the subject of the email?',
            no_body:    'What should the email say?',
          },
          es: {
            no_to:      '¿A quién le envío el correo? Dime el email exacto.',
            bad_email:  (addr: string) => `"${addr}" no parece un correo válido. ¿Me lo puedes dictar letra por letra?`,
            no_subject: '¿Cuál es el asunto del correo?',
            no_body:    '¿Qué quieres que diga el correo?',
          },
          pt: {
            no_to:      'Para quem devo enviar o email? Me diga o endereço exato.',
            bad_email:  (addr: string) => `"${addr}" não parece um email válido. Pode soletrar?`,
            no_subject: 'Qual é o assunto do email?',
            no_body:    'O que você quer que o email diga?',
          },
          fr: {
            no_to:      'À qui dois-je envoyer l\'email ? Donnez-moi l\'adresse exacte.',
            bad_email:  (addr: string) => `"${addr}" ne semble pas être un email valide. Pouvez-vous l'épeler ?`,
            no_subject: 'Quel est l\'objet de l\'email ?',
            no_body:    'Que doit dire l\'email ?',
          },
        } as const;
        const eT = emailT[lang as keyof typeof emailT] ?? emailT.en;
        if (!to) return { ok: false, fallback_text: eT.no_to };

        // If `to` is a name (no @), resolve it to an email via contacts lookup
        let resolvedTo = to;
        if (!EMAIL_RE.test(to)) {
          // Looks like a name — search contacts
          try {
            const findRes = await axios.get(
              `${apiBaseUrl.replace(/\/+$/, '')}/v1/contacts/find`,
              { headers, params: { q: to }, timeout: 8000 },
            );
            const contact: any = findRes.data?.contact;
            if (contact?.email) {
              resolvedTo = contact.email;
              // Ask Claude-style confirmation with the resolved email
              const confirmMsg = lang === 'es'
                ? `Encontré a ${contact.name || to} con el correo ${contact.email}. ¿Cuál es el asunto?`
                : `Found ${contact.name || to} with email ${contact.email}. What's the subject?`;
              if (!subject) return { ok: false, fallback_text: confirmMsg };
            } else {
              // Contact found but no email, or not found at all
              const notFoundMsg = lang === 'es'
                ? `No encontré el correo de ${to} en tus contactos. ¿Me lo dictas?`
                : `I couldn't find an email for ${to} in your contacts. Could you tell me the address?`;
              return { ok: false, fallback_text: notFoundMsg };
            }
          } catch {
            // Fallback: search with ILIKE
            try {
              const searchRes = await axios.get(
                `${apiBaseUrl.replace(/\/+$/, '')}/v1/contacts/search`,
                { headers, params: { q: to, limit: 1 }, timeout: 8000 },
              );
              const contacts: any[] = Array.isArray(searchRes.data?.contacts) ? searchRes.data.contacts : [];
              const match = contacts.find((c: any) => c?.email);
              if (match?.email) {
                resolvedTo = match.email;
                if (!subject) {
                  const confirmMsg = lang === 'es'
                    ? `Encontré a ${match.name || to} con el correo ${match.email}. ¿Cuál es el asunto?`
                    : `Found ${match.name || to} with email ${match.email}. What's the subject?`;
                  return { ok: false, fallback_text: confirmMsg };
                }
              } else {
                return { ok: false, fallback_text: lang === 'es'
                  ? `No encontré el correo de ${to}. ¿Me lo dictas?`
                  : `No email found for ${to}. Could you tell me the address?` };
              }
            } catch {
              return { ok: false, fallback_text: eT.bad_email(to) };
            }
          }
        }

        if (!EMAIL_RE.test(resolvedTo)) return { ok: false, fallback_text: eT.bad_email(resolvedTo) };
        if (!subject) return { ok: false, fallback_text: eT.no_subject };
        if (!body) return { ok: false, fallback_text: eT.no_body };
        const res = await axios.post(
          `${apiBaseUrl.replace(/\/+$/, '')}/v1/email/send`,
          { to: resolvedTo, subject, body },
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
        const evT = {
          en: { no_title: 'What is the event title?', no_date: 'What date is the event?', no_time: 'What time is the event?' },
          es: { no_title: '¿Cuál es el título del evento?', no_date: '¿Para qué fecha es el evento?', no_time: '¿A qué hora es el evento?' },
          pt: { no_title: 'Qual é o título do evento?', no_date: 'Para qual data é o evento?', no_time: 'A que horas é o evento?' },
          fr: { no_title: 'Quel est le titre de l\'événement ?', no_date: 'À quelle date est l\'événement ?', no_time: 'À quelle heure est l\'événement ?' },
        } as const;
        const eV = evT[lang as keyof typeof evT] ?? evT.en;
        if (!title) return { ok: false, fallback_text: eV.no_title };
        if (!date) return { ok: false, fallback_text: eV.no_date };
        if (!time) return { ok: false, fallback_text: eV.no_time };

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
        // Redirect to shopping list — cart is now shopping-list backed
        const store = String(slots.store || 'general').trim();
        const items = String(slots.items || '').trim();
        if (!items) return { ok: false, fallback_text: lang === 'es' ? '¿Qué quieres agregar?' : 'What should I add?' };
        const res = await axios.post(
          `${apiBaseUrl.replace(/\/+$/, '')}/v1/shopping-list/add`,
          { store, items },
          { headers },
        );
        return { ok: true, provider: 'api', endpoint: '/v1/shopping-list/add', data: res.data };
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

      if (intent === 'set_language') {
        const lang = String(slots.language || '').trim().toLowerCase();
        const validLangs = ['es', 'en', 'pt', 'fr'];
        const resolvedLang = validLangs.includes(lang) ? lang : 'es';
        try {
          await axios.patch(
            `${apiBaseUrl.replace(/\/+$/, '')}/v1/profiles/me`,
            { leeloo_language: resolvedLang },
            { headers },
          );
        } catch { /* non-fatal — UI will still update on next startup */ }
        return { ok: true, provider: 'api', endpoint: '/v1/profiles/me', data: { language: resolvedLang }, _languageChange: resolvedLang };
      }

      if (intent === 'save_memory') {
        const content = String(slots.content || '').trim();
        const category = String(slots.category || 'other').trim() || 'other';
        if (!content) return { ok: false, fallback_text: 'What should I remember?' };
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

      if (intent === 'list_goals' || intent === 'check_goals') {
        const res = await axios.get(`${apiBaseUrl.replace(/\/+$/, '')}/v1/goals`, { headers });
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

      if (intent === 'emotional_support' || intent === 'medical_query') {
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
          // Use /find (exact match first) not /search (ILIKE alphabetical) so "Vida" beats "Mi Vida"
          const findRes = await axios.get(
            `${apiBaseUrl.replace(/\/+$/, '')}/v1/contacts/find`,
            { headers, params: { q: contactName }, timeout: 10000 },
          );
          const contact: any = findRes.data?.contact;
          if (contact?.phone) {
            const clean = String(contact.phone).replace(/[^\d+]/g, '');
            return { ok: true, provider: 'phone', phone_number: clean, contact_name: contact.name || contactName };
          }
          const errMsg = contact
            ? (input.language === 'es'
                ? `Encontré a ${contact.name || contactName} pero no tengo su número. ¿Me lo dictas?`
                : `I found ${contact.name || contactName} but don't have their number. What is it?`)
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

      // Create a native device alarm — mobile handles 'device' provider directly
      if (intent === 'create_alarm') {
        const title = String(slots.title || 'Alarm').trim();
        const time = String(slots.time || '').trim();
        const recurrence = String(slots.recurrence || 'once').trim();
        if (!time) return { ok: false, fallback_text: lang === 'es' ? '¿A qué hora pongo la alarma?' : 'What time should I set the alarm for?' };
        return { ok: true, provider: 'device', action: 'create_alarm', title, time, recurrence };
      }

      if (intent === 'reschedule_reminder') {
        const reminderTitle = String(slots.reminder_title || '').trim();
        const newDatetime = String(slots.new_datetime || '').trim();
        if (!reminderTitle) return { ok: false, fallback_text: lang === 'es' ? '¿Qué recordatorio quieres mover?' : 'Which reminder should I reschedule?' };
        if (!newDatetime) return { ok: false, fallback_text: lang === 'es' ? '¿Para cuándo lo muevo?' : 'When should I reschedule it to?' };
        const searchRes = await axios.get(`${apiBaseUrl.replace(/\/+$/, '')}/v1/reminders/search`, {
          headers, params: { q: reminderTitle }, timeout: 10000,
        });
        const reminders: any[] = Array.isArray(searchRes.data?.reminders) ? searchRes.data.reminders : [];
        const match = reminders[0];
        if (!match?.id) return { ok: false, fallback_text: lang === 'es' ? `No encontré el recordatorio "${reminderTitle}".` : `Couldn't find reminder "${reminderTitle}".` };
        const res = await axios.patch(`${apiBaseUrl.replace(/\/+$/, '')}/v1/reminders/${match.id}/reschedule`, { new_datetime: newDatetime }, { headers });
        return { ok: true, provider: 'api', endpoint: `/v1/reminders/${match.id}/reschedule`, data: res.data };
      }

      if (intent === 'delete_reminder') {
        const reminderTitle = String(slots.reminder_title || '').trim();
        if (!reminderTitle) return { ok: false, fallback_text: lang === 'es' ? '¿Qué recordatorio elimino?' : 'Which reminder should I delete?' };
        const searchRes = await axios.get(`${apiBaseUrl.replace(/\/+$/, '')}/v1/reminders/search`, {
          headers, params: { q: reminderTitle }, timeout: 10000,
        });
        const reminders: any[] = Array.isArray(searchRes.data?.reminders) ? searchRes.data.reminders : [];
        const match = reminders[0];
        if (!match?.id) return { ok: false, fallback_text: lang === 'es' ? `No encontré el recordatorio "${reminderTitle}".` : `Couldn't find reminder "${reminderTitle}".` };
        await axios.delete(`${apiBaseUrl.replace(/\/+$/, '')}/v1/reminders/${match.id}`, { headers });
        return { ok: true, provider: 'api', endpoint: `/v1/reminders/${match.id}`, data: { deleted: true } };
      }

      if (intent === 'update_task') {
        const taskTitle = String(slots.task_title || '').trim();
        if (!taskTitle) return { ok: false, fallback_text: lang === 'es' ? '¿Qué tarea quieres editar?' : 'Which task should I update?' };
        const listRes = await axios.get(`${apiBaseUrl.replace(/\/+$/, '')}/v1/tasks`, { headers, timeout: 10000 });
        const tasks: any[] = Array.isArray(listRes.data) ? listRes.data : (Array.isArray(listRes.data?.tasks) ? listRes.data.tasks : []);
        const lower = taskTitle.toLowerCase();
        const match = tasks.find((t: any) => String(t?.title || '').toLowerCase().includes(lower));
        if (!match?.id) return { ok: false, fallback_text: lang === 'es' ? `No encontré la tarea "${taskTitle}".` : `Couldn't find task "${taskTitle}".` };
        const updates: Record<string, any> = {};
        if (slots.new_title) updates.title = String(slots.new_title).trim();
        if (slots.new_due_at) updates.due_at = String(slots.new_due_at).trim();
        if (Object.keys(updates).length === 0) return { ok: false, fallback_text: lang === 'es' ? '¿Qué quieres cambiar de la tarea?' : 'What should I change about the task?' };
        const res = await axios.patch(`${apiBaseUrl.replace(/\/+$/, '')}/v1/tasks/${match.id}`, updates, { headers });
        return { ok: true, provider: 'api', endpoint: `/v1/tasks/${match.id}`, data: res.data };
      }

      if (intent === 'delete_task') {
        const taskTitle = String(slots.task_title || '').trim();
        if (!taskTitle) return { ok: false, fallback_text: lang === 'es' ? '¿Qué tarea elimino?' : 'Which task should I delete?' };
        const listRes = await axios.get(`${apiBaseUrl.replace(/\/+$/, '')}/v1/tasks`, { headers, timeout: 10000 });
        const tasks: any[] = Array.isArray(listRes.data) ? listRes.data : (Array.isArray(listRes.data?.tasks) ? listRes.data.tasks : []);
        const lower = taskTitle.toLowerCase();
        const match = tasks.find((t: any) => String(t?.title || '').toLowerCase().includes(lower));
        if (!match?.id) return { ok: false, fallback_text: lang === 'es' ? `No encontré la tarea "${taskTitle}".` : `Couldn't find task "${taskTitle}".` };
        await axios.delete(`${apiBaseUrl.replace(/\/+$/, '')}/v1/tasks/${match.id}`, { headers });
        return { ok: true, provider: 'api', endpoint: `/v1/tasks/${match.id}`, data: { deleted: true, title: match.title } };
      }

      if (intent === 'update_event') {
        const eventTitle = String(slots.event_title || '').trim();
        if (!eventTitle) return { ok: false, fallback_text: lang === 'es' ? '¿Qué evento quieres editar?' : 'Which event should I update?' };
        const searchRes = await axios.get(`${apiBaseUrl.replace(/\/+$/, '')}/v1/calendar/events/search`, { headers, params: { q: eventTitle }, timeout: 10000 });
        const events: any[] = Array.isArray(searchRes.data) ? searchRes.data : [];
        const ev = events[0];
        if (!ev?.id) return { ok: false, fallback_text: lang === 'es' ? `No encontré el evento "${eventTitle}".` : `Couldn't find event "${eventTitle}".` };
        const updates: Record<string, any> = {};
        if (slots.new_title) updates.title = String(slots.new_title).trim();
        if (slots.new_date || slots.new_time) {
          const date = slots.new_date || String(ev.start_at || '').split('T')[0];
          const time = slots.new_time || String(ev.start_at || '').split('T')[1]?.slice(0, 5) || '00:00';
          updates.start_at = `${date}T${time}`;
        }
        if (slots.new_location) updates.location = String(slots.new_location).trim();
        if (Object.keys(updates).length === 0) return { ok: false, fallback_text: lang === 'es' ? '¿Qué quieres cambiar del evento?' : 'What should I change about the event?' };
        const res = await axios.put(`${apiBaseUrl.replace(/\/+$/, '')}/v1/calendar/events/${ev.id}`, updates, { headers });
        return { ok: true, provider: 'api', endpoint: `/v1/calendar/events/${ev.id}`, data: res.data };
      }

      if (intent === 'delete_event') {
        const eventTitle = String(slots.event_title || '').trim();
        if (!eventTitle) return { ok: false, fallback_text: lang === 'es' ? '¿Qué evento cancelo?' : 'Which event should I cancelar?' };
        const searchRes = await axios.get(`${apiBaseUrl.replace(/\/+$/, '')}/v1/calendar/events/search`, { headers, params: { q: eventTitle }, timeout: 10000 });
        const events: any[] = Array.isArray(searchRes.data) ? searchRes.data : [];
        const ev = events[0];
        if (!ev?.id) return { ok: false, fallback_text: lang === 'es' ? `No encontré el evento "${eventTitle}".` : `Couldn't find event "${eventTitle}".` };
        await axios.delete(`${apiBaseUrl.replace(/\/+$/, '')}/v1/calendar/events/${ev.id}`, { headers });
        return { ok: true, provider: 'api', endpoint: `/v1/calendar/events/${ev.id}`, data: { deleted: true, title: ev.title } };
      }

      if (intent === 'postpone_event') {
        const eventTitle = String(slots.event_title || '').trim();
        if (!eventTitle) return { ok: false, fallback_text: lang === 'es' ? '¿Qué evento quieres posponer?' : 'Which event should I postpone?' };
        const searchRes = await axios.get(`${apiBaseUrl.replace(/\/+$/, '')}/v1/calendar/events/search`, { headers, params: { q: eventTitle }, timeout: 10000 });
        const events: any[] = Array.isArray(searchRes.data) ? searchRes.data : [];
        const ev = events[0];
        if (!ev?.id) return { ok: false, fallback_text: lang === 'es' ? `No encontré el evento "${eventTitle}".` : `Couldn't find event "${eventTitle}".` };
        let newStart: Date;
        const delay = String(slots.delay || '').trim();
        if (delay.startsWith('+')) {
          const current = new Date(String(ev.start_at || ''));
          const m = delay.match(/^\+(\d+)(min|h|d)/);
          if (m) {
            const n = Number(m[1]);
            if (m[2] === 'min') newStart = new Date(current.getTime() + n * 60_000);
            else if (m[2] === 'h') newStart = new Date(current.getTime() + n * 3600_000);
            else newStart = new Date(current.getTime() + n * 86400_000);
          } else { newStart = current; }
        } else if (slots.new_date || slots.new_time) {
          const date = slots.new_date || String(ev.start_at || '').split('T')[0];
          const time = slots.new_time || String(ev.start_at || '').split('T')[1]?.slice(0, 5) || '00:00';
          newStart = new Date(`${date}T${time}`);
        } else {
          return { ok: false, fallback_text: lang === 'es' ? '¿Para cuándo lo pospongo?' : 'When should I postpone it to?' };
        }
        const duration = ev.end_at ? new Date(String(ev.end_at)).getTime() - new Date(String(ev.start_at)).getTime() : 30 * 60_000;
        const newEnd = new Date(newStart.getTime() + duration);
        const res = await axios.put(`${apiBaseUrl.replace(/\/+$/, '')}/v1/calendar/events/${ev.id}`, { start_at: newStart.toISOString(), end_at: newEnd.toISOString() }, { headers });
        return { ok: true, provider: 'api', endpoint: `/v1/calendar/events/${ev.id}`, data: res.data };
      }

      if (intent === 'set_personality') {
        const mode = String(slots.mode || 'default').trim().toLowerCase();
        const validModes = ['default', 'christian', 'coach', 'business', 'mentor', 'counselor', 'faith', 'motivation', 'nurturing'];
        const finalMode = validModes.includes(mode) ? mode : 'default';
        const res = await axios.patch(`${apiBaseUrl.replace(/\/+$/, '')}/v1/profiles/me`, { leeloo_personality: finalMode }, { headers });
        return { ok: true, provider: 'api', endpoint: '/v1/profiles/me', data: res.data, _personalityChange: finalMode };
      }

      if (intent === 'update_profile') {
        const key = String(slots.key || '').trim();
        const value = String(slots.value || '').trim();
        if (!key || !value) return { ok: false, fallback_text: lang === 'es' ? '¿Qué preferencia quieres guardar?' : 'What preference should I remember?' };
        const res = await axios.post(`${apiBaseUrl.replace(/\/+$/, '')}/v1/memories/save`, { content: `${key}: ${value}`, category: 'preference' }, { headers });
        return { ok: true, provider: 'api', endpoint: '/v1/memories/save', data: res.data };
      }

      if (intent === 'add_to_shopping_list') {
        const items = String(slots.items || '').trim();
        const store = String(slots.store || 'general').trim();
        if (!items) return { ok: false, fallback_text: lang === 'es' ? '¿Qué quieres agregar a la lista?' : 'What should I add to the list?' };
        const res = await axios.post(
          `${apiBaseUrl.replace(/\/+$/, '')}/v1/shopping-list/add`,
          { items, store },
          { headers },
        );
        return { ok: true, provider: 'api', endpoint: '/v1/shopping-list/add', data: res.data };
      }

      if (intent === 'view_shopping_list') {
        const store = String(slots.store || '').trim() || undefined;
        const res = await axios.get(`${apiBaseUrl.replace(/\/+$/, '')}/v1/shopping-list`, {
          headers,
          params: store ? { store } : {},
        });
        return { ok: true, provider: 'api', endpoint: '/v1/shopping-list', data: res.data };
      }

      if (intent === 'add_family_member') {
        const name = String(slots.name || '').trim();
        const role = String(slots.role || '').trim();
        if (!name) return { ok: false, fallback_text: lang === 'es' ? '¿Cuál es el nombre del familiar?' : 'What is the family member\'s name?' };
        if (!role) return { ok: false, fallback_text: lang === 'es' ? '¿Cuál es su relación contigo?' : 'What is their relationship to you?' };
        const res = await axios.post(
          `${apiBaseUrl.replace(/\/+$/, '')}/v1/family/members`,
          { name, role, age: slots.age ? Number(slots.age) : undefined },
          { headers },
        );
        return { ok: true, provider: 'api', endpoint: '/v1/family/members', data: res.data };
      }

      if (intent === 'assign_to_family_member') {
        const memberName = String(slots.member_name || '').trim();
        const taskTitle = String(slots.task_title || '').trim();
        const dueAt = String(slots.due_at || '').trim() || undefined;
        if (!memberName) return { ok: false, fallback_text: lang === 'es' ? '¿A quién asigno la tarea?' : 'Who should I assign this task to?' };
        if (!taskTitle) return { ok: false, fallback_text: lang === 'es' ? '¿Qué tarea asigno?' : 'What task should I assign?' };
        const res = await axios.post(
          `${apiBaseUrl.replace(/\/+$/, '')}/v1/tasks`,
          { title: taskTitle, description: `Asignado a: ${memberName}`, assignee_name: memberName, due_at: dueAt },
          { headers },
        );
        return { ok: true, provider: 'api', endpoint: '/v1/tasks', data: res.data };
      }

      if (intent === 'web_search') {
        const query = String(slots.query || '').trim();
        if (!query) return { ok: false, fallback_text: lang === 'es' ? '¿Qué quieres buscar?' : 'What should I search for?' };
        const tavilyKey = process.env.TAVILY_API_KEY;
        if (!tavilyKey) {
          this.logger.warn('[WEB_SEARCH] TAVILY_API_KEY not set — returning fallback');
          return { ok: false, fallback_text: lang === 'es' ? 'La búsqueda en internet no está disponible en este momento.' : 'Web search is not available right now.' };
        }
        try {
          // Tavily: free 1,000 searches/month — returns `answer` (AI-synthesized) + `results` (snippets)
          const searchRes = await axios.post(
            'https://api.tavily.com/search',
            { api_key: tavilyKey, query, search_depth: 'basic', max_results: 3, include_answer: true },
            { timeout: 10_000 },
          );
          const answer: string = String(searchRes.data?.answer || '').trim();
          const results: Array<{ title?: string; content?: string }> = searchRes.data?.results || [];

          let summary: string;
          if (answer) {
            // Tavily returns a direct synthesized answer — ideal for TTS
            const prefix = lang === 'es' ? '' : lang === 'pt' ? '' : '';
            summary = prefix + answer.slice(0, 450);
          } else if (results.length) {
            // Fallback: build summary from top snippets
            const snippets = results
              .filter((r) => r.content)
              .map((r) => r.content!.slice(0, 120))
              .join(' | ');
            const prefix = lang === 'es' ? `Sobre "${query}": ` : lang === 'pt' ? `Sobre "${query}": ` : `About "${query}": `;
            summary = prefix + snippets.slice(0, 400);
          } else {
            summary = lang === 'es' ? `No encontré resultados para "${query}".` : `No results found for "${query}".`;
          }

          this.logger.log(`[WEB_SEARCH] query="${query}" answer_len=${answer.length}`);
          return { ok: true, provider: 'tavily', endpoint: 'search', data: searchRes.data, _searchSummary: summary };
        } catch (searchErr: any) {
          this.logger.error('[WEB_SEARCH] Tavily search failed', searchErr?.message);
          const errText = lang === 'es' ? 'No pude conectarme a internet para buscar eso.' : 'I couldn\'t connect to the internet to search for that.';
          return { ok: false, fallback_text: errText };
        }
      }

      if (intent === 'search_walmart') {
        const query = String(slots.query || '').trim();
        const maxResults = Math.min(Math.max(Number(slots.max_results) || 3, 1), 5);
        if (!query) {
          return { ok: false, fallback_text: lang === 'es' ? '¿Qué quieres buscar en Walmart?' : 'What would you like to search on Walmart?' };
        }

        // Build Walmart search deep link (always available as fallback)
        const walmartSearchUrl = `https://www.walmart.com/search?q=${encodeURIComponent(query)}`;

        const tavilyKey = process.env.TAVILY_API_KEY;
        if (!tavilyKey) {
          // No search key — return deep link only
          const fallbackText = lang === 'es'
            ? `No tengo acceso a precios en este momento, pero te abro Walmart para buscar "${query}".`
            : `I can't check prices right now, but I'll open Walmart to search for "${query}".`;
          return { ok: true, provider: 'deeplink', _walmartUrl: walmartSearchUrl, _walmartProducts: [], _walmartQuery: query, _searchSummary: fallbackText };
        }

        try {
          // Tavily search scoped to walmart.com — returns product pages with prices
          const searchRes = await axios.post(
            'https://api.tavily.com/search',
            {
              api_key: tavilyKey,
              query: `${query} site:walmart.com`,
              search_depth: 'basic',
              max_results: maxResults + 2,
              include_answer: false,
              include_domains: ['walmart.com'],
            },
            { timeout: 10_000 },
          );

          const results: Array<{ title?: string; url?: string; content?: string }> = searchRes.data?.results || [];

          // Parse product results — extract title, price (if in snippet), and URL
          const products = results
            .filter((r) => r.url && r.url.includes('walmart.com/ip/'))
            .slice(0, maxResults)
            .map((r) => {
              const priceMatch = r.content?.match(/\$[\d,]+(?:\.\d{2})?/);
              return {
                name: r.title?.replace(/\s*-\s*Walmart\.com.*$/i, '').trim() || query,
                price: priceMatch ? priceMatch[0] : null,
                url: r.url!,
                snippet: r.content?.slice(0, 150) || '',
              };
            });

          let summary: string;
          if (products.length === 0) {
            summary = lang === 'es'
              ? `No encontré productos específicos de "${query}" en Walmart, pero te mando el enlace de búsqueda.`
              : `I didn't find specific products for "${query}" on Walmart, but here's the search link.`;
          } else {
            const topName = products[0].name;
            const topPrice = products[0].price;
            if (lang === 'es') {
              summary = topPrice
                ? `Encontré ${products.length} opcion${products.length > 1 ? 'es' : ''} en Walmart para "${query}". La primera: ${topName} — ${topPrice}.`
                : `Encontré ${products.length} opcion${products.length > 1 ? 'es' : ''} en Walmart para "${query}". La primera: ${topName}.`;
              if (products.length > 1) summary += ` Y ${products.length - 1} más. ¿Te mando el enlace?`;
            } else if (lang === 'pt') {
              summary = topPrice
                ? `Encontrei ${products.length} opção${products.length > 1 ? 'ões' : ''} no Walmart para "${query}". A primeira: ${topName} — ${topPrice}.`
                : `Encontrei ${products.length} opção${products.length > 1 ? 'ões' : ''} no Walmart para "${query}". A primeira: ${topName}.`;
            } else if (lang === 'fr') {
              summary = topPrice
                ? `J'ai trouvé ${products.length} option${products.length > 1 ? 's' : ''} sur Walmart pour "${query}". La première : ${topName} — ${topPrice}.`
                : `J'ai trouvé ${products.length} option${products.length > 1 ? 's' : ''} sur Walmart pour "${query}". La première : ${topName}.`;
            } else {
              summary = topPrice
                ? `Found ${products.length} option${products.length > 1 ? 's' : ''} on Walmart for "${query}". Top pick: ${topName} — ${topPrice}.`
                : `Found ${products.length} option${products.length > 1 ? 's' : ''} on Walmart for "${query}". Top pick: ${topName}.`;
              if (products.length > 1) summary += ` And ${products.length - 1} more.`;
            }
          }

          this.logger.log(`[WALMART_SEARCH] query="${query}" found=${products.length}`);
          return {
            ok: true,
            provider: 'tavily+walmart',
            _walmartUrl: products.length > 0 ? products[0].url : walmartSearchUrl,
            _walmartSearchUrl: walmartSearchUrl,
            _walmartProducts: products,
            _walmartQuery: query,
            _searchSummary: summary,
          };
        } catch (err: any) {
          this.logger.error('[WALMART_SEARCH] failed', err?.message);
          const fallbackText = lang === 'es'
            ? `No pude buscar ahora, pero te abro Walmart para "${query}".`
            : `Couldn't search right now, but I'll open Walmart for "${query}".`;
          return { ok: true, provider: 'deeplink', _walmartUrl: walmartSearchUrl, _walmartProducts: [], _walmartQuery: query, _searchSummary: fallbackText };
        }
      }

      if (intent === 'get_weather') {
        const rawLocation = String(slots.location || '').trim();
        const dateSlot = String(slots.date || 'today').trim();
        const weatherKey = process.env.OPENWEATHER_API_KEY;

        // Resolve location: slot → GPS coords (most accurate) → profile city → ask user
        const gpsLat = input.latitude;
        const gpsLon = input.longitude;
        let city = rawLocation;
        let useCoords = false;

        if (!city && gpsLat != null && gpsLon != null) {
          useCoords = true; // will use lat/lon in the API call directly
          city = input.city || ''; // city name for the response text only
        }

        if (!city && !useCoords) {
          try {
            const profileRes = await axios.get(`${apiBaseUrl.replace(/\/+$/, '')}/v1/profiles/me`, { headers });
            city = String(profileRes.data?.city || '').trim();
          } catch { /* ignore */ }
        }

        if (!city && !useCoords) {
          return { ok: true, provider: 'none', endpoint: null, data: null, _weatherMissing: true };
        }

        if (!weatherKey) {
          // Fallback: re-route as web_search with weather query
          const q = `clima ${city} ${dateSlot === 'today' ? 'hoy' : dateSlot === 'tomorrow' ? 'mañana' : 'esta semana'}`;
          const tavilyKey = process.env.TAVILY_API_KEY;
          if (tavilyKey) {
            try {
              const sr = await axios.post('https://api.tavily.com/search',
                { api_key: tavilyKey, query: q, search_depth: 'basic', max_results: 2, include_answer: true },
                { timeout: 10_000 });
              const answer = String(sr.data?.answer || '').trim();
              if (answer) return { ok: true, provider: 'tavily', endpoint: 'search', data: sr.data, _searchSummary: answer.slice(0, 400) };
            } catch { /* fall through */ }
          }
          return { ok: false, fallback_text: lang === 'es' ? 'El servicio de clima no está disponible.' : 'Weather service is unavailable.' };
        }

        try {
          const units = 'metric';
          // Prefer GPS coords for accuracy; fall back to city name
          const locParam = useCoords
            ? `lat=${gpsLat}&lon=${gpsLon}`
            : `q=${encodeURIComponent(city)}`;
          const displayCity = city || (useCoords ? `${gpsLat},${gpsLon}` : 'tu ubicación');
          const endpoint = dateSlot === 'week'
            ? `https://api.openweathermap.org/data/2.5/forecast?${locParam}&units=${units}&cnt=7&appid=${weatherKey}`
            : `https://api.openweathermap.org/data/2.5/weather?${locParam}&units=${units}&appid=${weatherKey}`;
          const wr = await axios.get(endpoint, { timeout: 8_000 });
          const d = wr.data;
          // Use city name returned by API when available (more readable)
          const apiCity = String(d.name || d.city?.name || displayCity);

          let summary: string;
          if (dateSlot === 'week' && d.list) {
            const days = (d.list as any[]).slice(0, 5).map((item: any) => {
              const date = new Date(item.dt * 1000).toLocaleDateString(lang === 'es' ? 'es-CO' : 'en-US', { weekday: 'short' });
              return `${date}: ${Math.round(item.main.temp)}°C ${item.weather?.[0]?.description || ''}`;
            }).join(', ');
            summary = lang === 'es' ? `Esta semana en ${apiCity}: ${days}` : `This week in ${apiCity}: ${days}`;
          } else {
            const temp = Math.round(d.main?.temp ?? 0);
            const feels = Math.round(d.main?.feels_like ?? 0);
            const desc = d.weather?.[0]?.description || '';
            const humidity = d.main?.humidity ?? 0;
            summary = lang === 'es'
              ? `En ${apiCity}: ${temp}°C, sensación de ${feels}°C, ${desc}. Humedad ${humidity}%.`
              : `In ${apiCity}: ${temp}°C, feels like ${feels}°C, ${desc}. Humidity ${humidity}%.`;
          }

          this.logger.log(`[WEATHER] city="${apiCity}" date="${dateSlot}" temp=${d.main?.temp} useCoords=${useCoords}`);
          return { ok: true, provider: 'openweather', endpoint, data: d, _weatherSummary: summary };
        } catch (we: any) {
          this.logger.error('[WEATHER] OpenWeather failed', we?.message);
          return { ok: false, fallback_text: lang === 'es' ? `No pude obtener el clima para ${city}.` : `Couldn't get weather for ${city}.` };
        }
      }

      if (intent === 'set_location') {
        const city = String(slots.city || '').trim();
        const country = String(slots.country || '').trim();
        if (!city) return { ok: false, fallback_text: lang === 'es' ? '¿Cuál ciudad?' : 'Which city?' };
        try {
          await axios.patch(
            `${apiBaseUrl.replace(/\/+$/, '')}/v1/profiles/me`,
            { city, country: country || undefined },
            { headers },
          );
          return { ok: true, provider: 'api', endpoint: '/v1/profiles/me', data: { city, country } };
        } catch (se: any) {
          return { ok: false, fallback_text: lang === 'es' ? 'No pude guardar tu ubicación.' : "Couldn't save your location." };
        }
      }

      if (intent === 'agenda_week') {
        const week = String(slots.week || 'current').trim();
        try {
          const now = new Date();
          const startOfWeek = new Date(now);
          const dayOfWeek = now.getDay();
          const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
          startOfWeek.setDate(diff);
          if (week === 'next') startOfWeek.setDate(startOfWeek.getDate() + 7);
          startOfWeek.setHours(0, 0, 0, 0);
          const endOfWeek = new Date(startOfWeek);
          endOfWeek.setDate(startOfWeek.getDate() + 6);
          endOfWeek.setHours(23, 59, 59, 999);

          const eventsRes = await axios.get(
            `${apiBaseUrl.replace(/\/+$/, '')}/v1/events?from=${startOfWeek.toISOString()}&to=${endOfWeek.toISOString()}&limit=20`,
            { headers },
          );
          return { ok: true, provider: 'api', endpoint: '/v1/events', data: eventsRes.data };
        } catch (ae: any) {
          return { ok: false, fallback_text: lang === 'es' ? 'No pude obtener tu agenda semanal.' : "Couldn't get your weekly agenda." };
        }
      }

      if (intent === 'check_family') {
        const memberName = String(slots.member_name || '').trim();
        try {
          const url = memberName
            ? `${apiBaseUrl.replace(/\/+$/, '')}/v1/family?name=${encodeURIComponent(memberName)}`
            : `${apiBaseUrl.replace(/\/+$/, '')}/v1/family`;
          const famRes = await axios.get(url, { headers });
          return { ok: true, provider: 'api', endpoint: '/v1/family', data: famRes.data };
        } catch (fe: any) {
          return { ok: false, fallback_text: lang === 'es' ? 'No encontré miembros de familia registrados.' : 'No family members found.' };
        }
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
