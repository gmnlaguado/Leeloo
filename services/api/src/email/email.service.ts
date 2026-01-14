import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class EmailService {
  constructor(private readonly configService: ConfigService) {}

  async sendEmail(params: { to: string; subject: string; text: string }): Promise<{ id: string; provider: string }> {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const from = this.configService.get<string>('EMAIL_FROM');

    if (!apiKey || !from) {
      throw new Error('Email is not configured');
    }

    const res = await axios.post(
      'https://api.resend.com/emails',
      {
        from,
        to: params.to,
        subject: params.subject,
        text: params.text,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );

    const id = res.data?.id;
    if (!id) {
      throw new Error('Email provider did not return an id');
    }

    return { id, provider: 'resend' };
  }
}
