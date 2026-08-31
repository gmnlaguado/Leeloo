import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

const VERSE_PLAN = [
  'john 3:16', 'psalm 23:1', 'philippians 4:13', 'jeremiah 29:11',
  'romans 8:28', 'proverbs 3:5-6', 'isaiah 40:31', 'matthew 6:33',
  'psalm 46:1', 'romans 12:2', 'joshua 1:9', '1 corinthians 13:4-7',
  'galatians 5:22-23', 'ephesians 2:8-9', 'psalm 119:105',
  'hebrews 11:1', 'james 1:2-4', '2 timothy 1:7', 'psalm 91:1-2',
  'john 14:6', 'revelation 21:4', 'isaiah 41:10', 'lamentations 3:22-23',
  'matthew 5:16', 'luke 6:31', 'john 16:33', 'romans 5:8',
  'ephesians 6:10-11', 'psalm 37:4', 'colossians 3:23',
  'matthew 28:20', 'philippians 4:6-7',
];

@Injectable()
export class VerseService {
  private readonly logger = new Logger(VerseService.name);

  private todayIndex(): number {
    const now = new Date();
    const dayOfYear = Math.floor(
      (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86_400_000,
    );
    return dayOfYear % VERSE_PLAN.length;
  }

  async getDailyVerse(): Promise<{ reference: string; text: string; reflection?: string }> {
    const ref = VERSE_PLAN[this.todayIndex()];
    try {
      const encoded = encodeURIComponent(ref);
      const res = await axios.get(`https://bible-api.com/${encoded}`, { timeout: 6_000 });
      const data = res.data as { reference?: string; text?: string };
      if (data?.text && data?.reference) {
        return {
          reference: data.reference,
          text: data.text.trim().replace(/\n/g, ' '),
        };
      }
    } catch (err) {
      this.logger.warn(`[VerseService] bible-api.com failed: ${String(err)} — using fallback`);
    }

    // Hardcoded fallback pool so the app never returns empty
    const fallbacks: Record<string, string> = {
      'john 3:16': 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.',
      'psalm 23:1': 'The Lord is my shepherd; I shall not want.',
      'philippians 4:13': 'I can do all this through him who gives me strength.',
      'jeremiah 29:11': 'For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you, plans to give you hope and a future.',
      'romans 8:28': 'And we know that in all things God works for the good of those who love him, who have been called according to his purpose.',
    };
    const text = fallbacks[ref] ?? fallbacks['psalm 23:1'];
    return { reference: ref, text };
  }
}
