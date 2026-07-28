import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private supabase: SupabaseClient;

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey =
      this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
      // Back-compat: accept the old name for one release; warn loudly.
      this.configService.get<string>('SUPABASE_SERVICE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        'Supabase configuration missing (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required)',
      );
    }

    if (
      !this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') &&
      this.configService.get<string>('SUPABASE_SERVICE_KEY')
    ) {
      console.warn(
        '[SupabaseService] SUPABASE_SERVICE_KEY is deprecated. Rename it to SUPABASE_SERVICE_ROLE_KEY.',
      );
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  getClient(): SupabaseClient {
    return this.supabase;
  }

  // Helper methods
  async getUserFromToken(token: string) {
    const {
      data: { user },
      error,
    } = await this.supabase.auth.getUser(token);

    if (error) throw error;
    return user;
  }
}
