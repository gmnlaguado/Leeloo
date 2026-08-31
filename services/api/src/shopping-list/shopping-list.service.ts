import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { ProfilesService } from '../profiles/profiles.service';

export type ShoppingStore = 'amazon' | 'walmart' | 'instacart' | 'general';

@Injectable()
export class ShoppingListService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly profilesService: ProfilesService,
  ) {}

  async onModuleInit() {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS shopping_list_items (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        title text NOT NULL,
        store text NOT NULL DEFAULT 'general',
        checked boolean NOT NULL DEFAULT false,
        added_at timestamptz DEFAULT NOW()
      )
    `);
    await this.db.query('CREATE INDEX IF NOT EXISTS idx_shopping_user ON shopping_list_items (user_id, store, checked)');
  }

  private async getProfileId(clerkUserId: string): Promise<string> {
    const p = await this.profilesService.ensureProfileByClerkUserId(clerkUserId);
    return p.id;
  }

  async addItems(clerkUserId: string, items: string[], store: ShoppingStore = 'general') {
    const profileId = await this.getProfileId(clerkUserId);
    const inserted: any[] = [];
    for (const title of items.map((i) => i.trim()).filter(Boolean)) {
      const res = await this.db.query(
        `INSERT INTO shopping_list_items (id, user_id, title, store)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [randomUUID(), profileId, title, store],
      );
      inserted.push(res.rows[0]);
    }
    return inserted;
  }

  async getItems(clerkUserId: string, store?: ShoppingStore) {
    const profileId = await this.getProfileId(clerkUserId);
    const storeFilter = store ? `AND store = '${store}'` : '';
    const res = await this.db.query(
      `SELECT * FROM shopping_list_items
       WHERE user_id = $1 AND checked = false ${storeFilter}
       ORDER BY added_at ASC`,
      [profileId],
    );
    return res.rows;
  }

  async checkItem(clerkUserId: string, id: string) {
    const profileId = await this.getProfileId(clerkUserId);
    const res = await this.db.query(
      `UPDATE shopping_list_items SET checked = true
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, profileId],
    );
    return res.rows[0];
  }

  async clearStore(clerkUserId: string, store: ShoppingStore) {
    const profileId = await this.getProfileId(clerkUserId);
    await this.db.query(
      `DELETE FROM shopping_list_items WHERE user_id = $1 AND store = $2`,
      [profileId, store],
    );
  }

  /** Deep link to open item search in Amazon or Walmart app/web */
  buildDeepLink(item: string, store: ShoppingStore): string {
    const q = encodeURIComponent(item);
    if (store === 'amazon')   return `https://www.amazon.com/s?k=${q}`;
    if (store === 'walmart')  return `https://www.walmart.com/search?q=${q}`;
    if (store === 'instacart') return `https://www.instacart.com/store/search_v3/term?term=${q}`;
    return '';
  }
}
