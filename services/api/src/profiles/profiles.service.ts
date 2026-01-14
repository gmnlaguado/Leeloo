import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type SupportedLanguage = 'es' | 'en' | 'pt' | 'fr';

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

  getConversationState(profile: any):
    | {
        preferred_language?: SupportedLanguage;
        pending_intent?: any;
        pending_slots?: any;
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
    if (lang === 'es' || lang === 'en' || lang === 'pt' || lang === 'fr') {
      return lang;
    }

    const locale = profile?.locale;
    if (locale === 'es' || locale === 'en' || locale === 'pt' || locale === 'fr') {
      return locale;
    }

    return null;
  }

  async ensureProfileByClerkUserId(
    clerkUserId: string,
    defaults?: { language?: SupportedLanguage },
  ) {
    const language = defaults?.language || 'es';

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
      pending_intent?: any;
      pending_slots?: any;
      next_question?: string;
    },
  ) {
    return this.updatePreferences(clerkUserId, {
      conversation_state: {
        ...(state.preferred_language ? { preferred_language: state.preferred_language } : {}),
        ...(state.pending_intent !== undefined ? { pending_intent: state.pending_intent } : {}),
        ...(state.pending_slots !== undefined ? { pending_slots: state.pending_slots } : {}),
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
