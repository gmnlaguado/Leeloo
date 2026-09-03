import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import {
  LEELOO_SYSTEM_PROMPT,
  LEELOO_SYSTEM_PROMPT_VERSION,
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

    // Always use LEELOO_SYSTEM_PROMPT — it contains the mandatory JSON format schema.
    // buildSystemPrompt() lacks those instructions and causes Claude to return prose.
    // User context (name, tasks, events) is injected into the memory context string.
    const systemPrompt = LEELOO_SYSTEM_PROMPT;
    const ctxLines = [
      ...(input.userName ? [`USER_NAME: ${input.userName}`] : []),
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
      }),
      ttsEarlyPromise,
    ]);
    this.logger.log(`[PIPE] action done +${ms()}ms — parallelTts=${canParallelTts}`);

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
      });
      const confirmedText = this.buildAssistantText(intent, confirmedAction);
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
    'chat', 'emotional_support', 'save_memory', 'set_language',
    'complete_task', 'set_goal',
    'daily_verse', 'suggest_meal', 'get_recipe', 'recommend_restaurant',
    'play_media', 'make_call', 'school_email_check',
    'add_to_shopping_list', 'view_shopping_list',
    'add_family_member', 'assign_to_family_member', 'list_goals', 'check_goals',
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
      'leeloo', 'leelo', 'liloo', 'lilo', 'lelu', 'leelu', 'lilu', 'lyloo',
      'leo', 'lielo', 'lelo', 'lylo',
      'hey leeloo', 'hey leelo', 'hey lilu', 'hey lelu',
      'oye leeloo', 'oye lelu', 'oye lilu',
      'hola leeloo', 'hola lelu',
      'hé leeloo', 'hé lilu',
      'ey leeloo', 'ey lelu', 'ey lilu',
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
      this.logger.warn(`[WAKE] detectWakeWord error — ${err?.message ?? String(err)}`);
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

  private buildAssistantText(intent: IntentResult, actionResult: any) {
    // Action failed — always speak the error, never the success text.
    // This prevents Leeloo from saying "Done! Task created!" when the POST actually failed.
    if (actionResult?.ok === false && actionResult?.fallback_text) {
      return String(actionResult.fallback_text);
    }

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
    const lang = this.normalizeLanguage(input.language);

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
        if (!EMAIL_RE.test(to)) return { ok: false, fallback_text: eT.bad_email(to) };
        if (!subject) return { ok: false, fallback_text: eT.no_subject };
        if (!body) return { ok: false, fallback_text: eT.no_body };
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
