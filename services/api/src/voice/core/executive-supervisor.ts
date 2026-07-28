import { SupportedLanguage } from '../../profiles/profiles.service';
import { DecisionToken, NormalizedInput } from './input-normalizer';

export type IntentState =
  | 'NONE'
  | 'DETECTED'
  | 'PENDING'
  | 'AWAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'DONE';

export type ExecutiveDecision =
  | { kind: 'SYSTEM_WAKE' }
  | { kind: 'SYSTEM_SLEEP' }
  | { kind: 'SYSTEM_OFF_BLOCK' }
  | { kind: 'BLOCK_EXECUTING' }
  | { kind: 'HANDLE_CONFIRMATION'; token: DecisionToken }
  | { kind: 'NORMAL_FLOW' };

export class ExecutiveSupervisor {
  decide(params: {
    input: NormalizedInput;
    state: any;
    language: SupportedLanguage;
    system_on: boolean;
  }): ExecutiveDecision {
    const { input, state, system_on } = params;

    const lower = input.cleaned.toLowerCase();
    const hasName =
      lower.includes('leeloo') ||
      lower.includes('lilo') ||
      lower.includes('lilu') ||
      lower.includes('lelu') ||
      lower.includes('lelo');

    const hasHey = lower.includes('hey') || lower.includes('ey') || lower.includes('oye');

    const isWake =
      lower.includes('leeloo despierta') ||
      lower.includes('leeloo, despierta') ||
      lower.includes('despierta leeloo') ||
      lower.includes('wake up') ||
      lower.includes('leeloo wake up') ||
      (hasHey && hasName);

    const isSleep =
      lower.includes('leeloo apágate') ||
      lower.includes('leeloo apagate') ||
      lower.includes('leeloo, apágate') ||
      lower.includes('leeloo, apagate') ||
      lower.includes('sleep') ||
      lower.includes('go to sleep') ||
      lower.includes('leeloo sleep');

    if (isWake) return { kind: 'SYSTEM_WAKE' };
    if (isSleep) return { kind: 'SYSTEM_SLEEP' };

    if (!system_on) return { kind: 'SYSTEM_OFF_BLOCK' };

    const intentState: IntentState | null = state?.intent_state || null;

    if (intentState === 'EXECUTING') return { kind: 'BLOCK_EXECUTING' };

    if (intentState === 'AWAITING_CONFIRMATION') {
      return { kind: 'HANDLE_CONFIRMATION', token: input.decision_token };
    }

    const pendingIntent = state?.pending_intent;
    const missingSlots: string[] = Array.isArray(state?.missing_slots) ? state.missing_slots : [];
    if (pendingIntent && missingSlots.length === 0) {
      return { kind: 'HANDLE_CONFIRMATION', token: input.decision_token };
    }

    return { kind: 'NORMAL_FLOW' };
  }
}
