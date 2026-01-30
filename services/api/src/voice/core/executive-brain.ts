export type ExecutiveSource = 'voice' | 'chat';

export type ExecutiveMode =
  | 'VOICE_TASK'
  | 'VOICE_CHAT'
  | 'CHAT_TASK'
  | 'CHAT_CONVERSATION'
  | 'COACH_MODE';

export type ExecutiveVerbosity = 'low' | 'medium';

export type ExecutiveTone = 'coach_calm_human';

export type ExecutiveBrainContext = {
  source: ExecutiveSource;
  language: 'es' | 'en' | 'pt' | 'fr' | 'ja';
  pending_intent: any | null;
  last_question: string | null;
  user_name: string | null;
  emotional_hint: 'neutral' | 'positive' | 'negative' | 'stressed';
  role_policy?: 'DEFAULT' | 'COACH' | 'PSYCHOLOGY' | 'TECH' | 'RELIGIOUS';
};

export type ExecutiveResponsePolicy = {
  mode: ExecutiveMode;
  tone: ExecutiveTone;
  verbosity: ExecutiveVerbosity;
  language: ExecutiveBrainContext['language'];
  max_sentences: number;
  forbid_multi_question: boolean;
  system_rules: string;
};

export type ExecutiveIntentSource = 'heuristic' | 'llm' | 'fallback';

export type ExecutiveIntent = {
  intent: string;
  language: 'es' | 'en' | 'pt' | 'fr' | 'ja' | null;
  confidence: number;
  required_slots: string[];
  filled_slots: Record<string, any>;
  missing_slots: string[];
  next_question: string;
  priority: 'low' | 'medium' | 'high';
  intent_source?: ExecutiveIntentSource;
};

export class ExecutiveBrain {
  assembleContext(params: {
    source: ExecutiveSource;
    language: ExecutiveBrainContext['language'];
    pending_intent?: any | null;
    last_question?: string | null;
    user_name?: string | null;
    input_normalized: string;
    role_policy?: ExecutiveBrainContext['role_policy'];
  }): ExecutiveBrainContext {
    const text = String(params.input_normalized || '').toLowerCase();

    const emotional_hint: ExecutiveBrainContext['emotional_hint'] = (() => {
      if (/\b(angry|furious|mad|upset|frustrated|stressed)\b/.test(text)) return 'stressed';
      if (/\b(sad|down|anxious|worried|depressed)\b/.test(text)) return 'negative';
      if (/\b(happy|great|good|excited)\b/.test(text)) return 'positive';
      if (/\b(triste|ansioso|ansiosa|deprimido|preocupado|preocupada|estresado|estresada|frustrado|frustrada|enojado|enojada)\b/.test(text)) return 'negative';
      return 'neutral';
    })();

    return {
      source: params.source,
      language: params.language,
      pending_intent: params.pending_intent ?? null,
      last_question: params.last_question ?? null,
      user_name: params.user_name ?? null,
      emotional_hint,
      role_policy: params.role_policy,
    };
  }

  inferVoiceIntentLayer0(text: string, language: ExecutiveBrainContext['language']): ExecutiveIntent | null {
    const raw = String(text || '').trim();
    if (!raw) return null;

    const normalize = (s: string) =>
      String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9\s@._-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const s = normalize(raw);
    const hasAny = (haystack: string, phrases: string[]) => phrases.some((p) => haystack.includes(normalize(p)));

    const isGreeting = hasAny(s, ['hi', 'hello', 'hey', 'buenas', 'hola', 'holi', 'saludos']);
    if (isGreeting) {
      return {
        intent: 'greeting',
        language: null,
        confidence: 0.7,
        required_slots: [],
        filled_slots: {},
        missing_slots: [],
        next_question: '',
        priority: 'low',
        intent_source: 'heuristic',
      };
    }

    const isReminderIntent = hasAny(s, [
      'recordatorio',
      'recu[eé]rdame',
      'recuerdame',
      'remind me',
      'reminder',
    ]);
    if (isReminderIntent) {
      const activity = (() => {
        const m = raw.match(/(?:recordatorio|reminder|remind me to|recu[eé]rdame)\s*[:\-]?\s*(.+)$/i);
        if (m && m[1]) return String(m[1]).trim();
        return '';
      })();

      const filled: any = {};
      if (activity) filled.activity = activity;

      const missing: string[] = [];
      if (!String(filled.activity || '').trim()) missing.push('activity');
      missing.push('start_at');

      const next_question = missing[0] === 'activity'
        ? (language === 'es' ? '¿Qué quieres que te recuerde?' : 'What should I remind you about?')
        : (language === 'es' ? '¿Para cuándo? (di fecha y hora)' : 'When? (say date and time)');

      return {
        intent: 'reminder',
        language: null,
        confidence: 0.72,
        required_slots: ['activity', 'start_at'],
        filled_slots: filled,
        missing_slots: missing,
        next_question,
        priority: 'high',
        intent_source: 'heuristic',
      };
    }

    const isScheduleMeetingIntent = hasAny(s, [
      'schedule',
      'meeting',
      'appointment',
      'event',
      'agenda',
      'calendario',
      'evento',
      'cita',
      'reunion',
      'reuni[oó]n',
    ]);
    if (isScheduleMeetingIntent) {
      const title = (() => {
        const m = raw.match(/(?:evento|event|cita|reuni[oó]n|reunion|agenda|calendario|meeting|appointment)\s*[:\-]?\s*(.+)$/i);
        if (m && m[1]) return String(m[1]).trim();
        return '';
      })();

      const filled: any = {};
      if (title) filled.title = title;

      const missing: string[] = [];
      if (!String(filled.title || '').trim()) missing.push('title');
      missing.push('start_at');

      const next_question = missing[0] === 'title'
        ? (language === 'es' ? '¿Qué título le pongo al evento?' : "What's the event title?")
        : (language === 'es' ? '¿Para cuándo es? (di fecha y hora)' : 'When is it? (say date and time)');

      return {
        intent: 'schedule_meeting',
        language: null,
        confidence: 0.7,
        required_slots: ['title', 'start_at'],
        filled_slots: filled,
        missing_slots: missing,
        next_question,
        priority: 'high',
        intent_source: 'heuristic',
      };
    }

    const wantsLanguageChange = hasAny(s, [
      'cambia a',
      'cambia el idioma a',
      'ponlo en',
      'pon el idioma en',
      'ponte en',
      'habla en',
      'hablame en',
      'en espanol',
      'en español',
      'in english',
      'in spanish',
      'speak',
      'language',
      'idioma',
    ]);

    const langMatch = s.match(
      /\b(speak|habla|hablame|idioma|language)\s+(english|ingles|inglés|spanish|espanol|español|portuguese|portugues|português|french|frances|francais|français|japanese|japones|japonés|ja)\b/i,
    );
    const langCandidate = (() => {
      if (langMatch && langMatch[2]) return String(langMatch[2]);
      const m2 = s.match(/\b(en|in)\s+(english|ingles|inglés|spanish|espanol|español|portuguese|portugues|português|french|frances|francais|français|japanese|japones|japonés)\b/i);
      if (m2 && m2[2]) return String(m2[2]);
      return '';
    })();

    if (wantsLanguageChange || langCandidate) {
      const cand = normalize(langCandidate || s);
      const lang =
        cand.includes('english') || cand.includes('ingles') ? 'en' :
        cand.includes('spanish') || cand.includes('espanol') ? 'es' :
        cand.includes('portuguese') || cand.includes('portugues') ? 'pt' :
        cand.includes('french') || cand.includes('francais') || cand.includes('frances') ? 'fr' :
        cand.includes('japanese') || cand.includes('japones') || cand.includes(' nihongo ') || cand === 'ja' ? 'ja' :
        null;

      if (lang) {
        return {
          intent: 'set_language',
          language: lang,
          confidence: 0.78,
          required_slots: [],
          filled_slots: { language: lang },
          missing_slots: [],
          next_question: '',
          priority: 'medium',
          intent_source: 'heuristic',
        };
      }
    }

    const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
    const email = raw.match(emailRegex)?.[0] || '';
    const isEmailIntent = hasAny(s, [
      'send email',
      'email',
      'correo',
      'mandar correo',
      'enviar correo',
      'mandar un email',
      'enviar un email',
    ]);
    if (isEmailIntent) {
      const filled: any = {};
      if (email) filled.to = email;

      const body = (() => {
        const m = raw.match(/(?:that says|saying|que diga|diciendo|mensaje|body)\s*[:\-]?\s*(.+)$/i);
        if (m && m[1]) return String(m[1]).trim();
        const m2 = raw.match(/(?:say|di|diga)\s+(.+)$/i);
        if (m2 && m2[1]) return String(m2[1]).trim();
        return '';
      })();
      if (body) filled.body = body;

      const missing: string[] = [];
      if (!filled.to) missing.push('to');
      if (!filled.body) missing.push('body');

      const next_question = (() => {
        if (missing[0] === 'to') {
          return language === 'es'
            ? '¿A qué correo quieres que lo envíe?'
            : 'What email address should I send it to?';
        }
        if (missing[0] === 'body') {
          return language === 'es'
            ? '¿Qué quieres que diga el correo? Dímelo tal cual y lo mando.'
            : "What should the email say? Tell me exactly and I’ll send it.";
        }
        return '';
      })();

      return {
        intent: 'send_email',
        language: null,
        confidence: 0.62,
        required_slots: ['to', 'body'],
        filled_slots: filled,
        missing_slots: missing,
        next_question,
        priority: 'high',
        intent_source: 'heuristic',
      };
    }

    const isTaskIntent = hasAny(s, [
      'create task',
      'add task',
      'new task',
      'tarea',
      'crear tarea',
      'agrega una tarea',
    ]);
    if (isTaskIntent) {
      const title = (() => {
        const m = raw.match(/(?:task|tarea|remind me to|recu[eé]rdame)\s*[:\-]?\s*(.+)$/i);
        if (m && m[1]) return String(m[1]).trim();
        return '';
      })();

      const filled: any = {};
      if (title) filled.title = title;

      const missing: string[] = [];
      if (!filled.title) missing.push('title');

      const next_question = missing.length
        ? (language === 'es' ? '¿Cuál es el título de la tarea?' : "What's the task title?")
        : '';

      return {
        intent: 'create_task',
        language: null,
        confidence: 0.62,
        required_slots: ['title'],
        filled_slots: filled,
        missing_slots: missing,
        next_question,
        priority: 'high',
        intent_source: 'heuristic',
      };
    }

    return null;
  }

  selectMode(ctx: ExecutiveBrainContext): ExecutiveMode {
    if (ctx.source === 'voice') {
      if (ctx.pending_intent) return 'VOICE_TASK';
      return 'VOICE_CHAT';
    }

    if (ctx.pending_intent) return 'CHAT_TASK';
    if (ctx.role_policy === 'COACH') return 'COACH_MODE';
    return 'CHAT_CONVERSATION';
  }

  buildResponsePolicy(ctx: ExecutiveBrainContext): ExecutiveResponsePolicy {
    const mode = this.selectMode(ctx);

    const isVoice = mode === 'VOICE_TASK' || mode === 'VOICE_CHAT';
    const verbosity: ExecutiveVerbosity = isVoice ? 'low' : 'medium';
    const maxSentences = isVoice ? 2 : 8;

    const systemRules = (() => {
      const base =
        `ROLE: Leeloo\n` +
        `MODE: ${mode}\n` +
        `TONE: coach calm, human\n` +
        `LANGUAGE: ${ctx.language}\n` +
        `RULES:\n` +
        `- The Executive Brain is authoritative.\n` +
        `- Follow the mode rules strictly.\n` +
        `- Never change language unless explicitly instructed by the user.\n`;

      if (isVoice) {
        return (
          base +
          `- VOICE: one idea, one emotion, max ${maxSentences} sentences.\n` +
          `- VOICE: ask at most ONE question.\n` +
          `- VOICE: never output long explanations.\n`
        );
      }

      return base + `- CHAT: you may be more detailed, but stay focused.\n`;
    })();

    return {
      mode,
      tone: 'coach_calm_human',
      verbosity,
      language: ctx.language,
      max_sentences: maxSentences,
      forbid_multi_question: true,
      system_rules: systemRules,
    };
  }

  postProcess(raw: string, policy: ExecutiveResponsePolicy): string {
    let out = String(raw || '').trim();
    if (!out) return '';

    out = out.replace(/\n{2,}/g, '\n').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').trim();
    out = out.replace(/\n+/g, ' ');
    out = out.replace(/\s+/g, ' ').trim();

    const sentences = out
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (sentences.length > policy.max_sentences) {
      out = sentences.slice(0, policy.max_sentences).join(' ');
    }

    if (policy.forbid_multi_question) {
      const qCount = (out.match(/\?/g) || []).length;
      if (qCount > 1) {
        const firstQ = out.indexOf('?');
        out = out.slice(0, firstQ + 1).trim();
      }
    }

    return out;
  }
}
