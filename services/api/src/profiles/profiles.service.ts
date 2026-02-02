import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type SupportedLanguage = 'es' | 'en' | 'pt' | 'fr' | 'ja';

@Injectable()
export class ProfilesService {
  constructor(private readonly db: DatabaseService) {}

  async getProfileByClerkUserId(clerkUserId: string) {
    const existing = await this.db.query(
      'SELECT * FROM profiles WHERE clerk_user_id = $1 LIMIT 1',
      [clerkUserId],
    );
    return existing.rows[0] || null;
  }

  getSystemOn(profile: any): boolean {
    const state = this.getConversationState(profile);
    if (typeof state?.system_on === 'boolean') return state.system_on;
    return true;
  }

  getConversationState(profile: any):
    | {
        preferred_language?: SupportedLanguage;
        mode?: 'conversation' | 'action';
        system_on?: boolean;
        intent_state?:
          | 'NONE'
          | 'DETECTED'
          | 'PENDING'
          | 'AWAITING_CONFIRMATION'
          | 'CONFIRMED'
          | 'EXECUTING'
          | 'EXECUTED'
          | 'DONE';
        assistant_name?: string;
        current_goal?: string;
        last_question?: string;
        last_intent?: string;
        last_action?: string;
        pending_intent?: any;
        pending_slots?: any;
        missing_slots?: string[];
        next_question?: string;
        updated_at?: string;
      }
    | null {
    const state = profile?.preferences?.conversation_state;
    return state && typeof state === 'object' ? state : null;
  }

  getPreferredLanguage(profile: any): SupportedLanguage | null {
    const state = this.getConversationState(profile);
    const lang = state?.preferred_language;
    if (lang === 'es' || lang === 'en' || lang === 'pt' || lang === 'fr' || lang === 'ja') {
      return lang;
    }

    const locale = profile?.locale;
    if (locale === 'es' || locale === 'en' || locale === 'pt' || locale === 'fr' || locale === 'ja') {
      return locale;
    }

    return null;
  }

  async ensureProfileByClerkUserId(
    clerkUserId: string,
    defaults?: { language?: SupportedLanguage },
  ) {
    const language = defaults?.language || 'en';

    const existing = await this.getProfileByClerkUserId(clerkUserId);
    if (existing) return existing;

    const created = await this.db.query(
      'INSERT INTO profiles (clerk_user_id, locale) VALUES ($1, $2) RETURNING *',
      [clerkUserId, language],
    );

    return created.rows[0];
  }

  async updateLanguage(clerkUserId: string, language: SupportedLanguage) {
    const res = await this.db.query(
      'UPDATE profiles SET locale = $1, updated_at = NOW() WHERE clerk_user_id = $2 RETURNING *',
      [language, clerkUserId],
    );

    return res.rows[0] || null;
  }

  async upsertUserIdentity(
    clerkUserId: string,
    identity: { display_name?: string; reply_to_email?: string; nickname?: string },
  ) {
    const existing = await this.ensureProfileByClerkUserId(clerkUserId);
    const current = (existing?.preferences?.user_identity && typeof existing.preferences.user_identity === 'object')
      ? existing.preferences.user_identity
      : {};

    const next = {
      ...current,
      ...(identity.display_name !== undefined ? { display_name: identity.display_name } : {}),
      ...(identity.reply_to_email !== undefined ? { reply_to_email: identity.reply_to_email } : {}),
      ...(identity.nickname !== undefined ? { nickname: identity.nickname } : {}),
    };

    return this.updatePreferences(clerkUserId, { user_identity: next });
  }

  async updatePreferences(clerkUserId: string, patch: Record<string, any>) {
    const res = await this.db.query(
      `UPDATE profiles
       SET preferences = COALESCE(preferences, '{}'::jsonb) || $1::jsonb,
           updated_at = NOW()
       WHERE clerk_user_id = $2
       RETURNING *`,
      [JSON.stringify(patch), clerkUserId],
    );
    return res.rows[0] || null;
  }

  async setConversationState(
    clerkUserId: string,
    state: {
      preferred_language?: SupportedLanguage;
      mode?: 'conversation' | 'action';
      system_on?: boolean;
      intent_state?:
        | 'NONE'
        | 'DETECTED'
        | 'PENDING'
        | 'AWAITING_CONFIRMATION'
        | 'CONFIRMED'
        | 'EXECUTING'
        | 'EXECUTED'
        | 'DONE';
      assistant_name?: string;
      current_goal?: string;
      last_question?: string;
      last_intent?: string;
      last_action?: string;
      pending_intent?: any;
      pending_slots?: any;
      missing_slots?: string[];
      next_question?: string;
    },
  ) {
    return this.updatePreferences(clerkUserId, {
      conversation_state: {
        ...(state.preferred_language ? { preferred_language: state.preferred_language } : {}),
        ...(state.mode ? { mode: state.mode } : {}),
        ...(state.system_on !== undefined ? { system_on: state.system_on } : {}),
        ...(state.intent_state ? { intent_state: state.intent_state } : {}),
        ...(state.assistant_name ? { assistant_name: state.assistant_name } : {}),
        ...(state.current_goal ? { current_goal: state.current_goal } : {}),
        ...(state.last_question !== undefined ? { last_question: state.last_question } : {}),
        ...(state.last_intent !== undefined ? { last_intent: state.last_intent } : {}),
        ...(state.last_action !== undefined ? { last_action: state.last_action } : {}),
        ...(state.pending_intent !== undefined ? { pending_intent: state.pending_intent } : {}),
        ...(state.pending_slots !== undefined ? { pending_slots: state.pending_slots } : {}),
        ...(state.missing_slots !== undefined ? { missing_slots: state.missing_slots } : {}),
        ...(state.next_question !== undefined ? { next_question: state.next_question } : {}),
        updated_at: new Date().toISOString(),
      },
    });
  }

  async clearConversationState(clerkUserId: string) {
    return this.updatePreferences(clerkUserId, {
      conversation_state: null,
    });
  }
}
