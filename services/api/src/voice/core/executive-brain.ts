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
