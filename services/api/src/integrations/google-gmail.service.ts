import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class GoogleGmailService {
  async listRecentMessages(accessToken: string, maxResults = 10) {
    const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { maxResults },
      timeout: 30000,
      validateStatus: () => true,
    });

    if (res.status >= 200 && res.status < 300) {
      return { ok: true, data: res.data };
    }

    return { ok: false, status: res.status, error: 'Gmail list failed' };
  }
}
