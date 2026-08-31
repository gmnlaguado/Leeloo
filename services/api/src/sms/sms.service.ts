import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  async send(params: { to: string; body: string }): Promise<{ ok: boolean; provider: string; sid?: string; deepLink?: string }> {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const authToken  = this.config.get<string>('TWILIO_AUTH_TOKEN');
    const fromNumber = this.config.get<string>('TWILIO_FROM_NUMBER');

    // If Twilio is configured — send real SMS
    if (accountSid && authToken && fromNumber) {
      try {
        const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
        const res = await axios.post(
          url,
          new URLSearchParams({ To: params.to, From: fromNumber, Body: params.body }).toString(),
          {
            auth: { username: accountSid, password: authToken },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15_000,
          },
        );
        return { ok: true, provider: 'twilio', sid: res.data?.sid };
      } catch (err: any) {
        this.logger.warn(`[SmsService] Twilio failed: ${String(err?.message)}. Falling back to WhatsApp deep link.`);
      }
    }

    // Fallback: WhatsApp deep link (works without Twilio account)
    const clean = params.to.replace(/[^\d+]/g, '');
    const encoded = encodeURIComponent(params.body);
    const deepLink = `https://wa.me/${clean}?text=${encoded}`;
    return { ok: true, provider: 'whatsapp_deeplink', deepLink };
  }
}
