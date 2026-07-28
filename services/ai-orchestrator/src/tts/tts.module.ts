import { Module } from '@nestjs/common';
import { ElevenLabsService } from './elevenlabs.service';
import { OpenAiTtsService } from './openai-tts.service';
import { TtsFactory } from './tts.factory';

@Module({
  providers: [ElevenLabsService, OpenAiTtsService, TtsFactory],
  exports: [ElevenLabsService, OpenAiTtsService, TtsFactory],
})
export class TtsModule {}
