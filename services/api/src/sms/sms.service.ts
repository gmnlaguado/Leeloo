import { Injectable } from '@nestjs/common';

@Injectable()
export class SmsService {
  async send(params: { to: string; body: string }) {
    return {
      ok: true,
      mock: true,
      to: params.to,
      body: params.body,
      provider: 'twilio',
    };
  }
}
