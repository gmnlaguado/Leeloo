import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import FormData = require('form-data');
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import { TasksService } from '../tasks/tasks.service';
import { MemoriesService } from '../memories/memories.service';
import { DatabaseService } from '../database/database.service';
import { ProfilesService, SupportedLanguage } from '../profiles/profiles.service';
import { R2Service } from '../r2/r2.service';

@Injectable()
export class VoiceService {
  private readonly openai: OpenAI | null;

  constructor(
    private configService: ConfigService,
    private tasksService: TasksService,
    private memoriesService: MemoriesService,
    private db: DatabaseService,
    private profilesService: ProfilesService,
    private r2: R2Service,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.openai = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async transcribeAudio(
    audioBuffer: Buffer,
    userContext?: { language?: string },
  ): Promise<string> {
    if (!audioBuffer || audioBuffer.length === 0) {
      return '';
    }

    const endpoint =
      this.configService.get<string>('STT_ENDPOINT') ||
      this.configService.get<string>('WHISPER_ENDPOINT');

    const language = (userContext?.language || 'en').toLowerCase();

    if (endpoint) {
      try {
        const url = `${endpoint.replace(/\/+$/, '')}/v1/transcribe`;
        const form = new FormData();
        form.append('file', audioBuffer, {
          filename: 'audio.m4a',
          contentType: 'audio/m4a',
        });
        form.append('language', language);

        const res = await axios.post(url, form, {
          timeout: 120000,
          headers: {
            ...form.getHeaders(),
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        });

        const text = res.data?.text;
        const out = typeof text === 'string' ? text.trim() : '';
        if (out) return out;

        console.error('[LeelooApi] STT: respuesta vacía (no debería pasar)', {
          status: res.status,
          data: res.data,
        });
      } catch (err) {
        console.error(
          '[LeelooApi] STT error:',
          (err as any)?.response?.status,
          (err as any)?.response?.data || String(err),
        );
      }
    } else {
      console.error('[LeelooApi] STT: STT_ENDPOINT no configurado');
    }

    // Fallback explícito: solo si hay OPENAI_API_KEY configurada.
    if (!this.openai) {
      return '';
    }

    try {
      const model = this.configService.get<string>('OPENAI_WHISPER_MODEL') || 'whisper-1';
      const file = await toFile(audioBuffer, 'audio.m4a', {
        type: 'audio/m4a',
      });

      const res = await this.openai.audio.transcriptions.create({
        file,
        model,
        language,
      });

      const text = (res as any)?.text;
      return typeof text === 'string' ? text.trim() : '';
    } catch (err) {
      console.error('[LeelooApi] OpenAI STT error:', (err as any)?.status, (err as any)?.error || String(err));
      return '';
    }
  }

  async processIntent(
    clerkUserId: string,
    text?: string,
    userContext?: { language?: string; faith_mode?: boolean; role?: string },
  ) {
    const cleanedText = (text || '').trim();

    let language = ((userContext?.language || 'en').toLowerCase() || 'en') as SupportedLanguage;

    const lower = cleanedText.toLowerCase();
    let requestedLanguage: SupportedLanguage | null = null;
    if (lower.includes('english') || lower.includes('inglés') || lower.includes('ingles')) {
      requestedLanguage = 'en';
    } else if (lower.includes('español') || lower.includes('espanol') || lower.includes('spanish')) {
      requestedLanguage = 'es';
    } else if (lower.includes('portugu') || lower.includes('português') || lower.includes('português')) {
      requestedLanguage = 'pt';
    } else if (lower.includes('français') || lower.includes('francais') || lower.includes('french')) {
      requestedLanguage = 'fr';
    }

    if (requestedLanguage) {
      language = requestedLanguage;
      await this.profilesService.ensureProfileByClerkUserId(clerkUserId, { language });
      await this.profilesService.updateLanguage(clerkUserId, language);
      const responseText =
        language === 'en'
          ? "Got it. I'll speak English from now on."
          : language === 'es'
            ? 'Listo. A partir de ahora te hablo en español.'
            : language === 'pt'
              ? 'Certo. A partir de agora vou falar em português.'
              : 'D’accord. Je parlerai français à partir de maintenant.';
      const audioUrl = await this.generateTTS(responseText, language);
      return {
        transcription: cleanedText,
        intent: { intent: 'set_language', confidence: 1, language },
        action_result: { preferred_language: language },
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    await this.profilesService.ensureProfileByClerkUserId(clerkUserId, { language });

    if (!cleanedText) {
      const responseText = this.buildSttFailureMessage(language);
      const audioUrl = await this.generateTTS(responseText, language);

      return {
        transcription: '',
        intent: null,
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    // Get user context/memories
    const memories = await this.memoriesService.getRelevantMemories(clerkUserId, cleanedText);
    const memoryContext = memories
      .map((m: any) => `${m.key}: ${JSON.stringify(m.value)}`)
      .join('\n');

    const intent = await this.extractIntent(cleanedText, memoryContext, language);

    console.log('[LeelooApi] voice intent', {
      userId: clerkUserId,
      intent: intent?.intent,
      confidence: intent?.confidence,
      language,
    });

    if (intent?.intent === 'system_unavailable') {
      const responseText = intent?.next_question || this.buildAiUnavailableMessage(language);
      const audioUrl = await this.generateTTS(responseText, language);

      return {
        transcription: cleanedText,
        intent,
        action_result: null,
        response_text: responseText,
        response_audio_url: audioUrl,
      };
    }

    // Execute actions based on intent
    let actionResult = null;
    if (intent.intent === 'create_task') {
      const taskTitle = (intent.filled_slots?.title || intent.title || '').trim();
      if (!taskTitle) {
        const responseText = this.buildMissingTaskTitleMessage(language);
        const audioUrl = await this.generateTTS(responseText, language);

        return {
          transcription: cleanedText,
          intent: {
            ...intent,
            missing_slots: Array.isArray(intent.missing_slots)
              ? Array.from(new Set([...intent.missing_slots, 'title']))
              : ['title'],
            next_question: intent.next_question || responseText,
          },
          action_result: null,
          response_text: responseText,
          response_audio_url: audioUrl,
        };
      }

      actionResult = await this.tasksService.createTask({
        user_id: clerkUserId,
        title: taskTitle,
        description: intent.filled_slots?.description || intent.description,
        due_at: intent.filled_slots?.due_at || intent.due_at,
        metadata: {
          ...(intent.metadata || {}),
          filled_slots: intent.filled_slots || {},
        },
        priority: intent.priority || 'medium',
      });

      console.log('[LeelooApi] action create_task', {
        userId: clerkUserId,
        taskId: (actionResult as any)?.id,
        title: (actionResult as any)?.title,
      });
    }

    // Generate TTS response
    const responseText = await this.generateResponse(
      intent,
      actionResult,
      language,
      userContext,
    );
    const audioUrl = await this.generateTTS(responseText, language);

    return {
      transcription: cleanedText,
      intent,
      action_result: actionResult,
      task_id: (actionResult as any)?.id || null,
      response_text: responseText,
      response_audio_url: audioUrl,
    };
  }

  private buildMissingTaskTitleMessage(language: SupportedLanguage): string {
    switch (language) {
      case 'es':
        return '¿Cuál es el título de la tarea?';
      case 'pt':
        return 'Qual é o título da tarefa?';
      case 'fr':
        return "Quel est le titre de la tâche ?";
      case 'en':
      default:
        return "What's the task title?";
    }
  }

  private async extractIntent(text: string, context: string, language: SupportedLanguage) {
    const endpoint =
      this.configService.get<string>('LLM_ENDPOINT') ||
      this.configService.get<string>('LOCAL_LLM_ENDPOINT');
    const apiKey =
      this.configService.get<string>('LLM_API_KEY') ||
      this.configService.get<string>('LOCAL_LLM_API_KEY');
    const model =
      this.configService.get<string>('LLM_MODEL') ||
      this.configService.get<string>('LOCAL_LLM_MODEL');

    if (!endpoint || !model) {
      return {
        intent: 'system_unavailable',
        confidence: 0,
        required_slots: [],
        filled_slots: {},
        missing_slots: [],
        next_question: this.buildAiUnavailableMessage(language),
        priority: 'low',
      };
    }

    const prompt =
      `Contexto del usuario (NO inventar):\n${context}\n\n` +
      `Texto del usuario: "${text}"\n\n` +
      'Devuelve SOLO JSON (sin markdown) con este schema fijo:\n' +
      '{\n' +
      '  "intent": "schedule_meeting" | "create_task" | "reminder" | "emotional_support" | "query",\n' +
      '  "confidence": 0.0,\n' +
      '  "required_slots": [],\n' +
      '  "filled_slots": {},\n' +
      '  "missing_slots": [],\n' +
      '  "next_question": "",\n' +
      '  "priority": "low" | "medium" | "high"\n' +
      '}\n\n' +
      `Idioma: ${language}.`;

    try {
      const res = await axios.post(
        endpoint,
        {
          model,
          messages: [
            {
              role: 'system',
              content:
                'Eres el Intent Engine de Leeloo Mom. NUNCA ejecutes acciones incompletas. Si faltan datos, llena missing_slots y formula next_question (una sola pregunta clara). Responde SOLO JSON válido.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          timeout: 60000,
        },
      );

      const content = res.data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('No content from LLM');
      }

      return JSON.parse(content);
    } catch (err) {
      console.error('[LeelooApi] LLM intent error:', (err as any)?.response?.status, (err as any)?.response?.data || String(err));
      return {
        intent: 'system_unavailable',
        confidence: 0,
        required_slots: [],
        filled_slots: {},
        missing_slots: [],
        next_question: this.buildAiUnavailableMessage(language),
        priority: 'low',
      };
    }
  }

  private async generateResponse(
    intent: any,
    actionResult: any,
    language: SupportedLanguage,
    userContext?: { faith_mode?: boolean; role?: string },
  ): Promise<string> {
    const endpoint =
      this.configService.get<string>('LLM_ENDPOINT') ||
      this.configService.get<string>('LOCAL_LLM_ENDPOINT');
    const apiKey =
      this.configService.get<string>('LLM_API_KEY') ||
      this.configService.get<string>('LOCAL_LLM_API_KEY');
    const model =
      this.configService.get<string>('LLM_MODEL') ||
      this.configService.get<string>('LOCAL_LLM_MODEL');

    if (!endpoint || !model) {
      return this.buildAiUnavailableMessage(language);
    }

    const coreRules =
      'No menciones IA, modelo, sistema, JSON, ni "intención".\n' +
      'Nunca confirmes acciones que no se hayan persistido.\n' +
      'Si faltan datos (missing_slots), haz UNA sola pregunta clara.\n';

    const roleTone = userContext?.role ? `Rol del usuario: ${userContext.role}.\n` : '';

    const prompt =
      `${coreRules}` +
      `${roleTone}` +
      `Idioma: ${language}.\n\n` +
      `Intent JSON: ${JSON.stringify(intent)}\n` +
      `Action result JSON: ${JSON.stringify(actionResult)}\n\n` +
      'Redacta una respuesta breve (2-4 frases) cálida, humana y práctica.';

    try {
      const res = await axios.post(
        endpoint,
        {
          model,
          messages: [
            {
              role: 'system',
              content:
                'Eres Leeloo Mom. Eres cálida, práctica y empática. Sigues reglas estrictas. ' +
                (userContext?.faith_mode ? '' : 'No incluyas contenido religioso.'),
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.4,
          top_p: 0.9,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          timeout: 60000,
        },
      );

      const content = res.data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('No content from LLM');
      }

      return content;
    } catch (err) {
      console.error('[LeelooApi] LLM response error:', (err as any)?.response?.status, (err as any)?.response?.data || String(err));
      return this.buildAiUnavailableMessage(language);
    }
  }

  private async generateTTS(text: string, _language: SupportedLanguage): Promise<string> {
    const apiKey = this.configService.get<string>('ELEVENLABS_API_KEY');
    const voiceId = this.configService.get<string>('ELEVENLABS_VOICE_ID');

    if (!apiKey || !voiceId) {
      return '';
    }

    const modelId =
      this.configService.get<string>('ELEVENLABS_MODEL_ID') || 'eleven_turbo_v2';

    try {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
      const response = await axios.post(
        url,
        {
          text,
          model_id: modelId,
        },
        {
          headers: {
            'xi-api-key': apiKey,
            Accept: 'audio/mpeg',
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
          timeout: 60000,
        },
      );

      const buffer = Buffer.from(response.data);
      const key = `tts/${Date.now()}.mp3`;
      const { url: publicUrl } = await this.r2.putPublicObject({
        key,
        body: buffer,
        contentType: 'audio/mpeg',
      });

      return publicUrl;
    } catch (err) {
      console.error('ElevenLabs TTS error:', (err as any)?.response?.status, (err as any)?.response?.data || String(err));
      return '';
    }
  }

  private buildAiUnavailableMessage(language: SupportedLanguage): string {
    switch (language) {
      case 'es':
        return 'En este momento no puedo conectarme al servicio de IA. ¿Puedes intentar de nuevo en unos segundos?';
      case 'pt':
        return 'No momento não consigo acessar o serviço de IA. Você pode tentar novamente em alguns segundos?';
      case 'fr':
        return "Je n'arrive pas à me connecter au service d'IA pour le moment. Peux-tu réessayer dans quelques secondes ?";
      case 'en':
      default:
        return "I can't reach the AI service right now. Can you try again in a few seconds?";
    }
  }

  private buildSttFailureMessage(language: SupportedLanguage): string {
    switch (language) {
      case 'es':
        return 'No pude transcribir tu audio con claridad. ¿Puedes repetirlo o escribirlo?';
      case 'pt':
        return 'Não consegui transcrever seu áudio com clareza. Você pode repetir ou digitar?';
      case 'fr':
        return "Je n'ai pas pu transcrire ton audio clairement. Peux-tu répéter ou écrire ?";
      case 'en':
      default:
        return "I couldn't transcribe your audio clearly. Can you repeat it or type it?";
    }
  }

  async logWakeEvent(clerkUserId: string) {
    const profile = await this.profilesService.ensureProfileByClerkUserId(clerkUserId);
    await this.db.query(
      `INSERT INTO wake_events (user_id, timestamp, metadata)
       VALUES ($1, NOW(), $2)`,
      [profile.id, {}],
    );

    return { success: true };
  }
}
