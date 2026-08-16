import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type UpcomingEvent = { id: string; title: string; start_at: string; location: string | null };
export type OverdueTask = { id: string; title: string; due_at: string };
export type PendingApproval = { id: string; child_name: string; message: string; created_at: string };
export type ConflictPair = {
  a: { id: string; title: string; start: string; end: string | null };
  b: { id: string; title: string; start: string; end: string | null };
};
export type TomorrowEvent = { title: string; start_at: string; location: string | null };
export type TodayEvent = { title: string; start_at: string | null };
export type BriefingTask = { title: string; due_at?: string | null };
export type MorningProfile = { id: string; timezone: string | null; display_name: string | null };

/**
 * Database access for the worker — uses Supabase REST/HTTPS instead of a
 * direct TCP pg connection, so it works on Render without the IPv4 add-on.
 * Env vars used: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (already set).
 */
@Injectable()
export class WorkerDbService implements OnModuleInit {
  private readonly logger = new Logger('WorkerDbService');
  private client: SupabaseClient | null = null;

  async onModuleInit() {
    const url = String(process.env.SUPABASE_URL || '').trim();
    const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !key) {
      this.logger.warn('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — DB features disabled');
      return;
    }
    this.client = createClient(url, key, { auth: { persistSession: false } });
    this.logger.log('WorkerDbService ready (Supabase REST — no direct PG/TCP)');
  }

  isReady() {
    return Boolean(this.client);
  }

  private get sb(): SupabaseClient {
    return this.client!;
  }

  // ── Push tokens ──────────────────────────────────────────────────────────
  async getPushTokens(userId: string): Promise<string[]> {
    const { data: rows } = await this.sb
      .from('push_tokens')
      .select('expo_push_token')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (rows && rows.length > 0) return rows.map((r: any) => r.expo_push_token).filter(Boolean);

    const { data: prof } = await this.sb
      .from('profiles')
      .select('expo_push_token')
      .eq('id', userId)
      .single();
    return prof?.expo_push_token ? [prof.expo_push_token] : [];
  }

  // ── Active users for sweep ───────────────────────────────────────────────
  async listActiveUserIds(): Promise<string[]> {
    const oneDayAgo = new Date(Date.now() - 86_400_000).toISOString();

    const [calRes, taskRes, reqRes] = await Promise.all([
      this.sb.from('calendar_events').select('user_id').gte('start_at', oneDayAgo),
      this.sb.from('tasks').select('user_id').eq('status', 'pending'),
      this.sb.from('child_requests').select('parent_id').eq('approved', false),
    ]);

    const ids = new Set<string>();
    (calRes.data ?? []).forEach((r: any) => r.user_id && ids.add(r.user_id));
    (taskRes.data ?? []).forEach((r: any) => r.user_id && ids.add(r.user_id));
    (reqRes.data ?? []).forEach((r: any) => r.parent_id && ids.add(r.parent_id));
    return [...ids];
  }

  // ── Calendar events ──────────────────────────────────────────────────────
  async getUpcomingEvents(userId: string): Promise<UpcomingEvent[]> {
    const now = new Date().toISOString();
    const twoHoursLater = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const { data } = await this.sb
      .from('calendar_events')
      .select('id, title, start_at, location')
      .eq('user_id', userId)
      .gte('start_at', now)
      .lte('start_at', twoHoursLater)
      .order('start_at');
    return (data ?? []) as UpcomingEvent[];
  }

  async getCalendarConflicts(userId: string): Promise<ConflictPair[]> {
    const now = new Date().toISOString();
    const sevenDays = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const { data } = await this.sb
      .from('calendar_events')
      .select('id, title, start_at, end_at')
      .eq('user_id', userId)
      .gte('start_at', now)
      .lt('start_at', sevenDays)
      .order('start_at');

    const events: any[] = data ?? [];
    const conflicts: ConflictPair[] = [];

    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const a = events[i], b = events[j];
        const aEnd = a.end_at ?? a.start_at;
        const bEnd = b.end_at ?? b.start_at;
        if (a.start_at < bEnd && b.start_at < aEnd) {
          const [first, second] = a.id < b.id ? [a, b] : [b, a];
          conflicts.push({
            a: { id: first.id, title: first.title, start: first.start_at, end: first.end_at },
            b: { id: second.id, title: second.title, start: second.start_at, end: second.end_at },
          });
        }
      }
    }
    return conflicts;
  }

  async getTomorrowEvents(userId: string): Promise<TomorrowEvent[]> {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const dateStr = tomorrow.toISOString().slice(0, 10);
    const dayAfter = new Date(tomorrow);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);

    const { data } = await this.sb
      .from('calendar_events')
      .select('title, start_at, location')
      .eq('user_id', userId)
      .gte('start_at', `${dateStr}T00:00:00.000Z`)
      .lt('start_at', dayAfter.toISOString().slice(0, 10) + 'T00:00:00.000Z')
      .order('start_at');
    return (data ?? []) as TomorrowEvent[];
  }

  async getTodayEvents(userId: string, startOfDay: Date, endOfDay: Date): Promise<TodayEvent[]> {
    const { data } = await this.sb
      .from('calendar_events')
      .select('title, start_at')
      .eq('user_id', userId)
      .gte('start_at', startOfDay.toISOString())
      .lte('start_at', endOfDay.toISOString())
      .order('start_at')
      .limit(5);
    return (data ?? []) as TodayEvent[];
  }

  // ── Tasks ────────────────────────────────────────────────────────────────
  async getOverdueTasks(userId: string): Promise<OverdueTask[]> {
    const now = new Date().toISOString();
    const { data } = await this.sb
      .from('tasks')
      .select('id, title, due_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .not('due_at', 'is', null)
      .lt('due_at', now)
      .order('due_at')
      .limit(20);
    return (data ?? []) as OverdueTask[];
  }

  async getPendingTasksDue(userId: string, dueDate: Date): Promise<BriefingTask[]> {
    const { data } = await this.sb
      .from('tasks')
      .select('title, due_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .or(`due_at.is.null,due_at.lte.${dueDate.toISOString()}`)
      .order('due_at', { nullsFirst: false })
      .limit(10);
    return (data ?? []) as BriefingTask[];
  }

  async getPendingTasksLimited(userId: string, limit = 3): Promise<BriefingTask[]> {
    const { data } = await this.sb
      .from('tasks')
      .select('title')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data ?? []) as BriefingTask[];
  }

  // ── Child requests ───────────────────────────────────────────────────────
  async getPendingApprovals(userId: string): Promise<PendingApproval[]> {
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { data } = await this.sb
      .from('child_requests')
      .select('id, child_name, message, created_at')
      .eq('parent_id', userId)
      .eq('approved', false)
      .lt('created_at', oneHourAgo)
      .order('created_at')
      .limit(20);
    return (data ?? []) as PendingApproval[];
  }

  // ── Mention dedup / insert ───────────────────────────────────────────────
  async hasMention(userId: string, kind: string, keyField: string, keyValue: string): Promise<boolean> {
    const { data } = await this.sb
      .from('pending_leeloo_mentions')
      .select('id')
      .eq('user_id', userId)
      .eq('mention_kind', kind)
      .eq('consumed', false)
      .filter(`payload->>${keyField}`, 'eq', keyValue)
      .limit(1);
    return (data ?? []).length > 0;
  }

  async insertMention(userId: string, kind: string, payload: object): Promise<void> {
    await this.sb
      .from('pending_leeloo_mentions')
      .insert({ user_id: userId, mention_kind: kind, payload });
  }

  // ── Briefings ────────────────────────────────────────────────────────────
  async insertBriefing(userId: string, briefingDate: string, text: string): Promise<void> {
    await this.sb.from('briefings').upsert(
      {
        user_id: userId,
        briefing_date: briefingDate,
        briefing_kind: 'tomorrow_preview',
        text_content: text,
      },
      { ignoreDuplicates: true },
    );
  }

  // ── Profiles / morning briefing ──────────────────────────────────────────
  async getUsersForMorningBriefing(): Promise<MorningProfile[]> {
    const { data } = await this.sb
      .from('profiles')
      .select('id, timezone, preferences')
      .not('expo_push_token', 'is', null);

    const today = new Date().toISOString().slice(0, 10);

    return (data ?? [])
      .filter((r: any) => {
        const prefs = r.preferences ?? {};
        const enabled = prefs.morning_briefing_enabled;
        const lastSent: string | undefined = prefs.morning_briefing_last_sent;
        const isEnabled = enabled === undefined || enabled === null || enabled === true || enabled === 'true';
        const notSentToday = !lastSent || lastSent.slice(0, 10) < today;
        return isEnabled && notSentToday;
      })
      .map((r: any) => ({
        id: r.id,
        timezone: r.timezone ?? null,
        display_name: r.preferences?.user_identity?.display_name ?? null,
      }));
  }

  async updateMorningBriefingLastSent(userId: string, sentAt: string): Promise<void> {
    const { data } = await this.sb
      .from('profiles')
      .select('preferences')
      .eq('id', userId)
      .single();
    const prefs = { ...(data?.preferences ?? {}), morning_briefing_last_sent: sentAt };
    await this.sb.from('profiles').update({ preferences: prefs }).eq('id', userId);
  }
}
