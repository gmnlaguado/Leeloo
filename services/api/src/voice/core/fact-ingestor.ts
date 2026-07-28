import { SupportedLanguage } from '../../profiles/profiles.service';
import { InputNormalizer } from './input-normalizer';

export type FactWrite = {
  namespace: 'identity' | 'household' | 'routine' | 'relationships' | 'preferences';
  key: string;
  value: any;
};

export class FactIngestor {
  private readonly normalizer = new InputNormalizer();

  ingest(text: string, language: SupportedLanguage): FactWrite[] {
    const cleaned = String(text || '').trim();
    if (!cleaned) return [];

    const raw = cleaned;
    const base = this.normalizer.normalizeBase(cleaned);

    const facts: FactWrite[] = [];

    const pushUnique = (f: FactWrite) => {
      const k = `${f.namespace}:${String(f.key)}`;
      const existing = new Set(facts.map((x) => `${x.namespace}:${String(x.key)}`));
      if (!existing.has(k)) facts.push(f);
    };

    const extractList = (segment: string): string[] => {
      const s = String(segment || '')
        .replace(/[.;:!?]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!s) return [];

      const parts = s
        .split(/,|\s+y\s+|\s+and\s+/i)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => p.replace(/^\b(un|una|unos|unas|el|la|los|las|some|a|an|the)\b\s+/i, '').trim())
        .filter(Boolean);

      return Array.from(new Set(parts)).slice(0, 50);
    };

    const groceryMatchEs = base.match(
      /\b(tengo|tenemos|hay|en mi cocina tengo|en casa tengo)\b\s+(.+)/i,
    );
    const groceryMatchEn = base.match(
      /\b(i have|we have|there is|there are|in my kitchen i have|at home i have)\b\s+(.+)/i,
    );
    const groceryMatch = groceryMatchEs || groceryMatchEn;
    if (groceryMatch && groceryMatch[2]) {
      const items = extractList(groceryMatch[2]);
      if (items.length > 0) {
        pushUnique({ namespace: 'household', key: 'grocery_list', value: items });
      }
    }

    const nameEs = raw.match(/\bme llamo\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\- ]{2,40})/i);
    const nameEn = raw.match(/\bmy name is\s+([A-Za-z'\- ]{2,40})/i);
    const name = (nameEs && nameEs[1]) || (nameEn && nameEn[1]) || null;
    if (name) {
      const normalizedName = String(name).trim().split(/\s+/).slice(0, 4).join(' ');
      if (normalizedName) pushUnique({ namespace: 'identity', key: 'name', value: normalizedName });
    }

    const prefVegEs = base.includes('soy vegetariano') || base.includes('soy vegetariana');
    const prefVegEn = base.includes('i am vegetarian') || base.includes("i'm vegetarian");
    if (prefVegEs || prefVegEn) {
      pushUnique({ namespace: 'preferences', key: 'diet', value: 'vegetarian' });
    }

    const dislikeEs = raw.match(/\bno (me gusta|como|quiero)\s+([^.;!?]{2,80})/i);
    const dislikeEn = raw.match(
      /\b(i don't like|i do not like|i don't eat|i do not eat)\s+([^.;!?]{2,80})/i,
    );
    const dislike = (dislikeEs && dislikeEs[2]) || (dislikeEn && dislikeEn[2]) || null;
    if (dislike) {
      const items = extractList(dislike);
      if (items.length > 0) pushUnique({ namespace: 'preferences', key: 'dislikes', value: items });
    }

    const likeEs = raw.match(/\bme gusta\s+([^.;!?]{2,80})/i);
    const likeEn = raw.match(/\b(i like|i love)\s+([^.;!?]{2,80})/i);
    const like = (likeEs && likeEs[1]) || (likeEn && likeEn[2]) || null;
    if (like) {
      const items = extractList(like);
      if (items.length > 0) pushUnique({ namespace: 'preferences', key: 'likes', value: items });
    }

    const wakeTimeEs = raw.match(
      /\b(me levanto|me despierto)\s+a\s+las\s+([0-9]{1,2}(:[0-9]{2})?\s*(am|pm)?)/i,
    );
    const wakeTimeEn = raw.match(
      /\b(i wake up|i get up)\s+at\s+([0-9]{1,2}(:[0-9]{2})?\s*(am|pm)?)/i,
    );
    const wakeTime = (wakeTimeEs && wakeTimeEs[2]) || (wakeTimeEn && wakeTimeEn[2]) || null;
    if (wakeTime) {
      pushUnique({ namespace: 'routine', key: 'wake_time', value: String(wakeTime).trim() });
    }

    const contactEs = raw.match(
      /\b(mi|mis)\s+(mam[aá]|pap[aá]|espos[aá]|novi[oa]|pareja|amig[oa])\s+se llama\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\- ]{2,40})/i,
    );
    const contactEn = raw.match(
      /\b(my)\s+(mom|mother|dad|father|wife|husband|girlfriend|boyfriend|partner|friend)\s+(is|is called|named)\s+([A-Za-z'\- ]{2,40})/i,
    );

    if (contactEs && contactEs[2] && contactEs[3]) {
      pushUnique({
        namespace: 'relationships',
        key: `contact_${this.normalizer.normalizeBase(contactEs[2])}`,
        value: { name: String(contactEs[3]).trim() },
      });
    } else if (contactEn && contactEn[2] && contactEn[4]) {
      pushUnique({
        namespace: 'relationships',
        key: `contact_${this.normalizer.normalizeBase(contactEn[2])}`,
        value: { name: String(contactEn[4]).trim() },
      });
    }

    const langExplicitEs =
      base.includes('mi idioma es espanol') || base.includes('mi idioma es español');
    const langExplicitEn = base.includes('my language is english');
    if (langExplicitEs) pushUnique({ namespace: 'identity', key: 'language', value: 'es' });
    if (langExplicitEn) pushUnique({ namespace: 'identity', key: 'language', value: 'en' });

    void language;
    return facts;
  }
}
