import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type SupportedLanguage = 'es' | 'en' | 'pt' | 'fr';

@Injectable()
export class ProfilesService {
  constructor(private readonly db: DatabaseService) {}

  async ensureProfileByClerkUserId(
    clerkUserId: string,
    defaults?: { language?: SupportedLanguage },
  ) {
    const language = defaults?.language || 'es';

    const existing = await this.db.query(
      'SELECT * FROM profiles WHERE clerk_user_id = $1 LIMIT 1',
      [clerkUserId],
    );

    if (existing.rows[0]) {
      return existing.rows[0];
    }

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
}
