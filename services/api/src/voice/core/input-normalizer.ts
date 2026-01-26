export type DecisionToken = 'YES' | 'NO' | 'CANCEL' | 'OTHER';

export type NormalizedInput = {
  raw: string;
  cleaned: string;
  normalized: string;
  decision_token: DecisionToken;
};

export class InputNormalizer {
  normalizeBase(raw: string): string {
    return String(raw || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  normalizeForDecision(raw: string): string {
    let out = this.normalizeBase(raw);
    out = out
      .replace(/\b(este|eh|mmm|mm|um|uh|pues|bueno|okey|oye|a ver)\b/g, ' ')
      .replace(/\b(por favor|pls|please|gracias|muchas gracias)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return out;
  }

  decisionToken(raw: string): DecisionToken {
    const s = this.normalizeForDecision(raw);
    if (!s) return 'OTHER';

    const cancel =
      s === 'cancel' ||
      s === 'cancelar' ||
      s.includes('cancela eso') ||
      s.includes('cancelalo') ||
      s.includes('olvidalo') ||
      s.includes('olvidate') ||
      s.includes('ya no') ||
      s.includes('no lo hagas') ||
      s.includes('no lo envies') ||
      s.includes('no lo mandes');
    if (cancel) return 'CANCEL';

    const yesRegex = /^(si|s i|claro|dale|ok|okay|vale|de una|adelante|confirma|confirmo|yes|yeah|yep|sure|confirm)(\b|$)/;
    const noRegex = /^(no|negativo|mejor no|no gracias|nope|nah|dont|do not|don t|stop|cancel)(\b|$)/;

    const hasYes =
      yesRegex.test(s) ||
      s === 'si' ||
      s === 'sí' ||
      s === 'ok' ||
      s === 'okay' ||
      s === 'vale' ||
      s === 'claro' ||
      s === 'confirmo' ||
      s === 'confirma' ||
      s === 'yes' ||
      s === 'yep' ||
      s === 'yeah' ||
      s === 'sure';

    const hasNo =
      noRegex.test(s) ||
      s === 'no' ||
      s === 'nope' ||
      s === 'nah';

    if (hasYes && !hasNo) return 'YES';
    if (hasNo && !hasYes) return 'NO';
    return 'OTHER';
  }

  normalize(raw: string): NormalizedInput {
    const cleaned = String(raw || '').trim();
    const normalized = this.normalizeBase(cleaned);
    const decision_token = this.decisionToken(cleaned);
    return { raw: String(raw || ''), cleaned, normalized, decision_token };
  }
}
