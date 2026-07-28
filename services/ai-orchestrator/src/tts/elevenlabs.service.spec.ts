import { ElevenLabsService } from './elevenlabs.service';

describe('ElevenLabsService', () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  it('isEnabled returns false when api key or voice id are missing', () => {
    process.env = { ...ORIGINAL_ENV, ELEVENLABS_API_KEY: '', ELEVENLABS_VOICE_ID: '' };
    const svc = new ElevenLabsService();
    expect(svc.isEnabled()).toBe(false);
  });

  it('isEnabled returns true when both env vars are set', () => {
    process.env = {
      ...ORIGINAL_ENV,
      ELEVENLABS_API_KEY: 'k',
      ELEVENLABS_VOICE_ID: 'v',
    };
    const svc = new ElevenLabsService();
    expect(svc.isEnabled()).toBe(true);
  });

  it('synthesize throws when not configured', async () => {
    process.env = { ...ORIGINAL_ENV, ELEVENLABS_API_KEY: '', ELEVENLABS_VOICE_ID: '' };
    const svc = new ElevenLabsService();
    await expect(svc.synthesize('hola')).rejects.toThrow(/not configured/);
  });

  it('synthesize calls ElevenLabs API with multilingual model', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      ELEVENLABS_API_KEY: 'test-key',
      ELEVENLABS_VOICE_ID: 'voice-leeloo',
    };
    const svc = new ElevenLabsService();
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
      text: async () => '',
    })) as unknown as typeof fetch;
    (global as any).fetch = fetchMock;

    const buf = await svc.synthesize('Hola Mariana');
    expect(buf).toBeInstanceOf(Buffer);
    const call = (fetchMock as unknown as jest.Mock).mock.calls[0];
    expect(call[0]).toContain('voice-leeloo');
    const body = JSON.parse(call[1].body);
    expect(body.model_id).toBe('eleven_multilingual_v2');
    expect(body.voice_settings.use_speaker_boost).toBe(true);
  });
});
