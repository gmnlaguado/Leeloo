export type ConfidenceBreakdown = {
  intent_confidence: number;
  slot_confidence: number;
  combined_confidence: number;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function normalizeConfidence(raw: any, floor = 0.65): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  // Eliminate 0 by enforcing a floor; still allow low values via combined scoring rules.
  return clamp01(Math.max(floor, n));
}

export function computeSlotConfidence(params: {
  intentName: string;
  filled: Record<string, any>;
  missing: string[];
}): number {
  const { intentName, filled, missing } = params;
  void intentName;

  // If the model already claims missing slots, slot confidence should drop.
  if (missing && missing.length > 0) return 0.4;

  // Minimal heuristics for critical slots.
  const hasNonEmpty = (v: any) =>
    typeof v === 'string' ? v.trim().length > 0 : v !== null && v !== undefined;

  // For send_email, critical: to + body
  if (intentName === 'send_email') {
    const ok = hasNonEmpty(filled?.to) && hasNonEmpty(filled?.body);
    return ok ? 0.95 : 0.4;
  }

  // For create_task/reminder, critical: title/activity
  if (intentName === 'create_task') {
    const ok = hasNonEmpty(filled?.title) || hasNonEmpty((filled as any)?.activity);
    return ok ? 0.9 : 0.45;
  }

  if (intentName === 'reminder') {
    const ok = hasNonEmpty((filled as any)?.activity) || hasNonEmpty(filled?.title);
    return ok ? 0.85 : 0.45;
  }

  // Queries or emotional support don't need slots.
  return 0.9;
}

export function computeConfidence(params: {
  intent_confidence_raw: any;
  slot_confidence: number;
  floor?: number;
}): ConfidenceBreakdown {
  const floor = params.floor ?? 0.65;
  const intent_confidence = normalizeConfidence(params.intent_confidence_raw, floor);
  const slot_confidence = clamp01(params.slot_confidence);

  // Combined confidence as a conservative product.
  const combined_confidence = clamp01(intent_confidence * slot_confidence);

  return { intent_confidence, slot_confidence, combined_confidence };
}
