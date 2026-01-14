import { SupportedLanguage } from '../../profiles/profiles.service';

export type EmotionLabel =
  | 'calm'
  | 'stressed'
  | 'confused'
  | 'sad'
  | 'frustrated'
  | 'angry'
  | 'anxious';

export type EmotionSignal = {
  label: EmotionLabel;
  intensity: number; // 0..1
  evidence?: string[];
};

export function detectEmotionHeuristic(text: string): EmotionSignal {
  const t = (text || '').toLowerCase();
  const evidence: string[] = [];

  const has = (re: RegExp, tag: string) => {
    if (re.test(t)) evidence.push(tag);
  };

  // Spanish + English minimal heuristics
  has(/\b(no puedo|no puedo más|me supera|me siento mal|me siento fatal)\b/, 'overwhelmed_es');
  has(/\b(estoy triste|me siento triste|deprimid[oa])\b/, 'sad_es');
  has(/\b(ansios[oa]|me da ansiedad|ataque de p[aá]nico)\b/, 'anxious_es');
  has(/\b(confundid[oa]|no entiendo|no me queda claro)\b/, 'confused_es');
  has(/\b(frustrad[oa]|harto|harta|me molesta|me da rabia)\b/, 'frustrated_es');

  has(/\b(i can't|i can’t|i can't do this|overwhelmed|this is too much)\b/, 'overwhelmed_en');
  has(/\b(i'm sad|im sad|depressed)\b/, 'sad_en');
  has(/\b(anxious|panic attack)\b/, 'anxious_en');
  has(/\b(confused|i don't understand|i dont understand)\b/, 'confused_en');
  has(/\b(frustrated|annoyed|pissed|angry)\b/, 'frustrated_en');

  // Simple punctuation/emphasis signals
  if ((text || '').includes('!!!') || (text || '').includes('???')) evidence.push('punctuation');

  if (evidence.length === 0) {
    return { label: 'calm', intensity: 0 };
  }

  const score = Math.min(1, 0.35 + evidence.length * 0.15);

  if (evidence.some((e) => e.includes('sad'))) return { label: 'sad', intensity: score, evidence };
  if (evidence.some((e) => e.includes('anxious') || e.includes('overwhelmed'))) return { label: 'anxious', intensity: score, evidence };
  if (evidence.some((e) => e.includes('confused'))) return { label: 'confused', intensity: score, evidence };
  if (evidence.some((e) => e.includes('frustrated'))) return { label: 'frustrated', intensity: score, evidence };

  return { label: 'stressed', intensity: score, evidence };
}

export function emotionLeadSentence(language: SupportedLanguage, emotion: EmotionSignal): string | null {
  if (!emotion || emotion.label === 'calm' || emotion.intensity < 0.35) return null;

  if (language === 'es') {
    switch (emotion.label) {
      case 'sad':
        return 'Siento que esto te está pesando. Estoy contigo.';
      case 'confused':
        return 'Tranquila. Lo vamos a ordenar paso a paso.';
      case 'frustrated':
      case 'angry':
        return 'Te entiendo. Esto frustra, y tiene sentido que te moleste.';
      case 'anxious':
      case 'stressed':
      default:
        return 'Respira conmigo un segundo. Estoy aquí contigo.';
    }
  }

  // English
  switch (emotion.label) {
    case 'sad':
      return 'I can hear this has been heavy. I’m with you.';
    case 'confused':
      return 'No worries—we’ll sort it out step by step.';
    case 'frustrated':
    case 'angry':
      return 'I get it—this is frustrating, and your reaction makes sense.';
    case 'anxious':
    case 'stressed':
    default:
      return 'Take a breath with me for a second. I’m here.';
  }
}
