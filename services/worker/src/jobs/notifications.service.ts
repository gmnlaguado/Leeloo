import { Injectable, Logger } from '@nestjs/common';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { WorkerDbService } from './worker-db.service';

export interface SendPushArgs {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  badge?: number;
  sound?: 'default' | null;
  priority?: 'default' | 'high';
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('NotificationsService');
  private readonly expo: Expo;

  constructor(private readonly db: WorkerDbService) {
    this.expo = new Expo({
      accessToken: String(process.env.EXPO_ACCESS_TOKEN || '').trim() || undefined,
    });
  }

  async getActiveTokens(userId: string): Promise<string[]> {
    if (!this.db.isReady()) return [];
    const res = await this.db.query<{ expo_push_token: string }>(
      `SELECT expo_push_token FROM push_tokens
       WHERE user_id = $1 AND is_active = true`,
      [userId],
    );
    const tokens = res.rows.map((r) => r.expo_push_token).filter(Boolean);

    if (tokens.length > 0) return tokens;

    const fallback = await this.db.query<{ expo_push_token: string | null }>(
      `SELECT expo_push_token FROM profiles WHERE id = $1`,
      [userId],
    );
    const t = fallback.rows[0]?.expo_push_token;
    return t ? [t] : [];
  }

  async sendPush(args: SendPushArgs): Promise<{ sent: number; tickets: ExpoPushTicket[] }> {
    const tokens = await this.getActiveTokens(args.userId);
    if (tokens.length === 0) {
      this.logger.debug(`[notifications] no tokens for user=${args.userId}`);
      return { sent: 0, tickets: [] };
    }

    const messages: ExpoPushMessage[] = tokens
      .filter((t) => Expo.isExpoPushToken(t))
      .map((to) => ({
        to,
        title: args.title,
        body: args.body,
        sound: args.sound === null ? null : 'default',
        badge: args.badge,
        priority: args.priority || 'default',
        data: args.data ?? {},
      }));

    if (messages.length === 0) {
      this.logger.warn(`[notifications] no valid Expo tokens for user=${args.userId}`);
      return { sent: 0, tickets: [] };
    }

    const tickets: ExpoPushTicket[] = [];
    for (const chunk of this.expo.chunkPushNotifications(messages)) {
      try {
        const t = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.push(...t);
      } catch (err) {
        this.logger.warn(
          `[notifications] sendPushNotificationsAsync failed: ${(err as Error).message}`,
        );
      }
    }
    return { sent: messages.length, tickets };
  }
}
