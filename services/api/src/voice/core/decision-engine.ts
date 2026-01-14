import { ConfidenceBreakdown } from './confidence';

export type DecisionType = 'ACTION' | 'QUESTION' | 'COACH' | 'IGNORE';

export type DecisionInput = {
  intentName: string;
  missingSlots: string[];
  confidence: ConfidenceBreakdown;
  last_intent?: string | null;
  last_question?: string | null;
  last_action?: string | null;
};

export type DecisionOutput = {
  decision: DecisionType;
  reason: string;
};

export function decide(input: DecisionInput): DecisionOutput {
  const { intentName, missingSlots, confidence, last_intent, last_action } = input;
  const c = confidence.combined_confidence;

  // Hard block: missing critical slots => QUESTION (even if confidence is high)
  if (missingSlots && missingSlots.length > 0) {
    return { decision: 'QUESTION', reason: 'missing_critical_slots' };
  }

  // Anti-loop hard lock: repeated intent + repeated action key
  if (last_intent && last_intent === intentName && last_action && last_action === intentName) {
    return { decision: 'IGNORE', reason: 'repeated_intent_action_lock' };
  }

  if (c < 0.6) return { decision: 'QUESTION', reason: 'low_confidence' };
  if (c < 0.8) return { decision: 'COACH', reason: 'mid_confidence' };

  return { decision: 'ACTION', reason: 'high_confidence' };
}
