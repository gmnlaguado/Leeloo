import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  date: string;
  isUnread: boolean;
  body?: string;
}

@Injectable()
export class GoogleGmailService {
  private readonly logger = new Logger('GoogleGmailService');

  // ── List inbox ──────────────────────────────────────────────────────────────
  async listInbox(
    accessToken: string,
    opts: { maxResults?: number; q?: string; unreadOnly?: boolean } = {},
  ): Promise<{ ok: boolean; messages?: GmailMessage[]; total?: number; error?: string }> {
    const maxResults = Math.min(opts.maxResults ?? 10, 20);
    const params: Record<string, any> = {
      maxResults,
      labelIds: opts.unreadOnly ? ['INBOX', 'UNREAD'] : ['INBOX'],
    };
    if (opts.q) params.q = opts.q;

    try {
      const listRes = await axios.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params,
        timeout: 10_000,
        validateStatus: () => true,
      });

      if (listRes.status === 401) return { ok: false, error: 'google_token_expired' };
      if (listRes.status !== 200) return { ok: false, error: `Gmail list failed (${listRes.status})` };

      const rawMessages: any[] = listRes.data?.messages ?? [];
      if (!rawMessages.length) return { ok: true, messages: [], total: 0 };

      const details = await Promise.all(
        rawMessages.slice(0, 10).map((m: any) => this.getMessageMetadata(accessToken, m.id)),
      );

      return {
        ok: true,
        messages: details.filter(Boolean) as GmailMessage[],
        total: listRes.data?.resultSizeEstimate ?? details.length,
      };
    } catch (err: any) {
      this.logger.error(`listInbox error: ${err?.message}`);
      return { ok: false, error: 'Gmail API unavailable' };
    }
  }

  // ── Get message metadata (fast — no body) ──────────────────────────────────
  async getMessageMetadata(accessToken: string, id: string): Promise<GmailMessage | null> {
    try {
      const res = await axios.get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] },
        timeout: 8_000,
        validateStatus: () => true,
      });
      if (res.status !== 200) return null;
      return this.parseMessage(res.data);
    } catch { return null; }
  }

  // ── Get full message with body ─────────────────────────────────────────────
  async getMessageFull(
    accessToken: string,
    id: string,
  ): Promise<{ ok: boolean; message?: GmailMessage; error?: string }> {
    try {
      const res = await axios.get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { format: 'full' },
        timeout: 10_000,
        validateStatus: () => true,
      });
      if (res.status === 401) return { ok: false, error: 'google_token_expired' };
      if (res.status !== 200) return { ok: false, error: `Failed to get message (${res.status})` };

      const msg = this.parseMessage(res.data);
      if (!msg) return { ok: false, error: 'Failed to parse message' };
      msg.body = this.extractBody(res.data?.payload)?.slice(0, 3000);
      return { ok: true, message: msg };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  }

  // ── Send email via Gmail API (requires gmail.send scope) ───────────────────
  async sendGmailMessage(
    accessToken: string,
    opts: {
      to: string;
      subject: string;
      body: string;
      fromName?: string;
      threadId?: string;
    },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    try {
      const subjectEncoded = this.encodeRFC2047(opts.subject);
      const mimeRaw = [
        `To: ${opts.to}`,
        `Subject: ${subjectEncoded}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(opts.body, 'utf-8').toString('base64'),
      ].join('\r\n');

      const payload: any = { raw: Buffer.from(mimeRaw).toString('base64url') };
      if (opts.threadId) payload.threadId = opts.threadId;

      const res = await axios.post(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        payload,
        {
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          timeout: 15_000,
          validateStatus: () => true,
        },
      );

      if (res.status === 401) return { ok: false, error: 'google_token_expired' };
      if (res.status !== 200) {
        const detail = JSON.stringify(res.data).slice(0, 200);
        this.logger.warn(`sendGmailMessage non-200: ${res.status} — ${detail}`);
        return { ok: false, error: `Gmail send failed (${res.status})` };
      }

      return { ok: true, messageId: res.data.id };
    } catch (err: any) {
      this.logger.error(`sendGmailMessage error: ${err?.message}`);
      return { ok: false, error: err?.message };
    }
  }

  // ── Mark message as read ───────────────────────────────────────────────────
  async markAsRead(accessToken: string, id: string): Promise<void> {
    try {
      await axios.post(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`,
        { removeLabelIds: ['UNREAD'] },
        { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 5_000, validateStatus: () => true },
      );
    } catch { /* non-fatal */ }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  private parseMessage(data: any): GmailMessage | null {
    if (!data?.id) return null;
    const headers: any[] = data?.payload?.headers ?? [];
    const getH = (name: string) => headers.find((h: any) => h.name === name)?.value ?? '';

    const fromRaw = getH('From');
    const nameMatch = fromRaw.match(/^(.+?)\s*<(.+?)>$/);
    const fromName = nameMatch ? nameMatch[1].trim().replace(/^"|"$/g, '') : fromRaw;
    const fromEmail = nameMatch ? nameMatch[2].trim() : fromRaw;
    const labelIds: string[] = data?.labelIds ?? [];

    return {
      id: data.id,
      threadId: data.threadId ?? '',
      from: fromName || fromEmail,
      fromEmail,
      subject: getH('Subject') || '(no subject)',
      snippet: (data.snippet ?? '')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>'),
      date: getH('Date'),
      isUnread: labelIds.includes('UNREAD'),
    };
  }

  private extractBody(payload: any): string {
    if (!payload) return '';
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
    }
    if (payload.parts) {
      for (const part of payload.parts) {
        const text = this.extractBody(part);
        if (text) return text;
      }
    }
    return '';
  }

  private encodeRFC2047(text: string): string {
    if (/^[\x00-\x7E]*$/.test(text)) return text;
    return `=?UTF-8?B?${Buffer.from(text, 'utf-8').toString('base64')}?=`;
  }

  // Legacy stub — kept for existing endpoint compatibility
  async listRecentMessages(accessToken: string, maxResults = 10) {
    return this.listInbox(accessToken, { maxResults });
  }
}
