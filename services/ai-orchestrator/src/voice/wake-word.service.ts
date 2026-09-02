/**
 * Backend-side wake word detector.
 *
 * Used both by services/api/voice (when wake_word_only=true is set) and
 * services/ai-orchestrator. Whisper transcribes a 1-2s audio clip, then we
 * fuzzy-match the canonical phrases. Cheap and language-tolerant.
 */
import { Injectable } from '@nestjs/common';

export const WAKE_PHRASES = [
  // Exact phrases
  'hey leeloo', 'hi leeloo', 'hello leeloo',
  'oye leeloo', 'hola leeloo',
  'ei leeloo', 'ey leeloo',
  'hey leelo', 'hei leeloo',
  // Groq commonly transcribes "Leeloo" as these — verified from prod logs
  'lilou', 'hi lilou', 'hey lilou', 'hola lilou', 'oye lilou',
  // Standalone keyword variants
  'leeloo', 'leelo', 'liloo', 'liloo',
  'lilu', 'lilo', 'lelu', 'lelo',
  'leelu', 'lyloo', 'lylo', 'lielo',
  // French
  'he leeloo', 'he lilu',
];

export function normalizeForWake(input: string): string {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectWakeWord(transcription: string): boolean {
  const n = normalizeForWake(transcription);
  if (!n) return false;
  return WAKE_PHRASES.some((p) => n.includes(p));
}

@Injectable()
export class WakeWordService {
  detect(transcription: string): boolean {
    return detectWakeWord(transcription);
  }
}
