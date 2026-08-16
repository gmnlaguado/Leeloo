import { Injectable } from '@nestjs/common';

export type IntegrationJobName = 'google_calendar_sync' | 'gmail_sync';

export type GoogleCalendarSyncJob = {
  userId: string;
};

export type GmailSyncJob = {
  userId: string;
};

@Injectable()
export class IntegrationsQueueService {
  async enqueueGoogleCalendarSync(payload: GoogleCalendarSyncJob) {
    return { ok: true, job: 'google_calendar_sync', userId: payload.userId };
  }

  async enqueueGmailSync(payload: GmailSyncJob) {
    return { ok: true, job: 'gmail_sync', userId: payload.userId };
  }
}
