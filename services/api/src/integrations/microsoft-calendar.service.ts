import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class MicrosoftCalendarService {
  async listRecentEvents(accessToken: string, top = 10) {
    const url = 'https://graph.microsoft.com/v1.0/me/events';
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { $top: top },
      timeout: 30000,
      validateStatus: () => true,
    });

    if (res.status >= 200 && res.status < 300) {
      return { ok: true, data: res.data };
    }

    return { ok: false, status: res.status, error: 'Microsoft events list failed' };
  }
}
