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
    return this.db.getPushTokens(userId);
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
