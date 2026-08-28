import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { ok: true };
  }

  @Get('test')
  async test() {
    const results: Record<string, any> = {};

    // 1 — Anthropic (Claude)
    try {
      const key = String(process.env.ANTHROPIC_API_KEY || '').trim();
      if (!key) throw new Error('ANTHROPIC_API_KEY not set');
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey: key });
      const r = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'ping' }],
      });
      results.anthropic = { ok: true, model: r.model };
    } catch (e: any) {
      results.anthropic = { ok: false, error: String(e?.message || e) };
    }

    // 2 — ElevenLabs
    try {
      const key = String(process.env.ELEVENLABS_API_KEY || '').trim();
      const voiceId = String(process.env.ELEVENLABS_VOICE_ID || '').trim();
      if (!key || !voiceId) throw new Error(`missing: ${!key ? 'ELEVENLABS_API_KEY' : 'ELEVENLABS_VOICE_ID'}`);
      const res = await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
        headers: { 'xi-api-key': key },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text().catch(() => '')}`);
      const voice = await res.json() as any;
      results.elevenlabs = { ok: true, voice_name: voice?.name, voice_id: voiceId };
    } catch (e: any) {
      results.elevenlabs = { ok: false, error: String(e?.message || e) };
    }

    // 3 — leeloo-stt
    try {
      const sttUrl = String(process.env.STT_URL || '').trim();
      if (!sttUrl) throw new Error('STT_URL not set');
      const res = await fetch(`${sttUrl}/health`, { signal: AbortSignal.timeout(8_000) });
      const body = await res.json().catch(() => ({ ok: res.ok }));
      results.stt = { ok: res.ok, url: sttUrl, body };
    } catch (e: any) {
      results.stt = { ok: false, error: String(e?.message || e) };
    }

    // 4 — Groq STT (check key only)
    const groqKey = String(process.env.GROQ_API_KEY || '').trim();
    results.groq = { configured: Boolean(groqKey), note: groqKey ? 'key present' : 'GROQ_API_KEY not set — STT has no fallback' };

    // 5 — TTS provider in use
    const ttsProvider = String(process.env.TTS_PROVIDER || 'elevenlabs').toLowerCase();
    results.tts_provider = { configured_as: ttsProvider };

    // 6 — Env summary (values hidden)
    results.env = {
      ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
      ELEVENLABS_API_KEY: Boolean(process.env.ELEVENLABS_API_KEY),
      ELEVENLABS_VOICE_ID: Boolean(process.env.ELEVENLABS_VOICE_ID),
      GROQ_API_KEY: Boolean(process.env.GROQ_API_KEY),
      STT_URL: Boolean(process.env.STT_URL),
      TTS_PROVIDER: process.env.TTS_PROVIDER || '(not set → defaults to elevenlabs)',
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
      SUPABASE_SERVICE_KEY: Boolean(process.env.SUPABASE_SERVICE_KEY),
    };

    const allOk = results.anthropic.ok && results.elevenlabs.ok;
    return { ok: allOk, timestamp: new Date().toISOString(), checks: results };
  }
}
