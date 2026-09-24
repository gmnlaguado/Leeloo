import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { useVoiceStore } from '@/store/voice';
import { VoiceButton } from '@/components/VoiceButton';
import { useAuthStore } from '@/store/auth';
import { useTasksStore } from '@/store/tasks';
import { ChildRequestBanner } from '@/components/ChildRequestBanner';
import { useRouter } from 'expo-router';
import { WaveBackground } from '@/components/WaveBackground';
import { T } from '@/lib/theme';
import { Search } from 'lucide-react-native';
import { format } from 'date-fns';
import { es, enUS, ptBR, fr as frLocale } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { profilesAPI, verseAPI, weatherAPI } from '@/lib/api';
import { useSettingsStore } from '@/store/settings';
import { deviceLogger } from '@/services/device-logger';
import { wakeWordService } from '@/services/wake-word';

// ─── Minimal UI translations (4 languages) ────────────────────────────────────
const UI_STRINGS = {
  en: {
    greeting_morning: 'Good morning',
    greeting_afternoon: 'Good afternoon',
    greeting_evening: 'Good evening',
    hello: 'Hello',
    fallback_name: '',
    ask_leeloo: 'Tap the button below or say "Hey Leeloo"',
    text_fallback_label: 'Prefer to type?',
    plan_title: "Today's plan",
    ask_plan: 'Ask Leeloo what you have today →',
    actions_title: 'Quick actions',
    action_agenda: 'My agenda',
    action_emails: 'Emails',
    action_tasks: 'Tasks',
    action_mode: 'Leeloo mode',
    action_shopping: 'Shopping',
    tag_home: 'HOME',
    tag_work: 'WORK',
    no_date: 'No date',
    write_here: 'Write here...',
    calendar_title: 'Calendar',
    agenda_cmd: 'what do I have today',
    emails_cmd: 'check my emails',
    date_format: 'EEEE, MMMM d',
    pw_christian: 'Verse of the day',
    pw_coach: "Today's challenge",
    pw_business: 'Executive briefing',
    pw_mentor: 'Mentor reflection',
    pw_counselor: 'Your space',
    pw_faith: "Today's purpose",
    pw_default: 'Your day',
  },
  es: {
    greeting_morning: 'Buenos días',
    greeting_afternoon: 'Buenas tardes',
    greeting_evening: 'Buenas noches',
    hello: 'Hola',
    fallback_name: 'amiga',
    ask_leeloo: 'Toca el botón o di "Hey Leeloo"',
    text_fallback_label: '¿Prefieres escribir?',
    plan_title: 'Tu plan de hoy',
    ask_plan: 'Pregúntale a Leeloo qué tienes hoy →',
    actions_title: 'Acciones rápidas',
    action_agenda: 'Mi agenda',
    action_emails: 'Correos',
    action_tasks: 'Tareas',
    action_mode: 'Modo Leeloo',
    action_shopping: 'Compras',
    tag_home: 'HOGAR',
    tag_work: 'TRABAJO',
    no_date: 'Sin fecha',
    write_here: 'Escribe aquí...',
    calendar_title: 'Calendario',
    agenda_cmd: 'qué tengo para hoy',
    emails_cmd: 'revisa mis correos',
    date_format: "EEEE d 'de' MMMM",
    pw_christian: 'Versículo del día',
    pw_coach: 'Desafío de hoy',
    pw_business: 'Briefing ejecutivo',
    pw_mentor: 'Reflexión del mentor',
    pw_counselor: 'Tu espacio',
    pw_faith: 'Propósito del día',
    pw_default: 'Tu día',
  },
  pt: {
    greeting_morning: 'Bom dia',
    greeting_afternoon: 'Boa tarde',
    greeting_evening: 'Boa noite',
    hello: 'Olá',
    fallback_name: 'amiga',
    ask_leeloo: 'Toque no botão ou diga "Hey Leeloo"',
    text_fallback_label: 'Prefere digitar?',
    plan_title: 'Seu plano de hoje',
    ask_plan: 'Pergunte à Leeloo o que você tem hoje →',
    actions_title: 'Ações rápidas',
    action_agenda: 'Minha agenda',
    action_emails: 'E-mails',
    action_tasks: 'Tarefas',
    action_mode: 'Modo Leeloo',
    action_shopping: 'Compras',
    tag_home: 'CASA',
    tag_work: 'TRABALHO',
    no_date: 'Sem data',
    write_here: 'Escreva aqui...',
    calendar_title: 'Calendário',
    agenda_cmd: 'o que tenho para hoje',
    emails_cmd: 'verificar meus e-mails',
    date_format: "EEEE, d 'de' MMMM",
    pw_christian: 'Versículo do dia',
    pw_coach: 'Desafio de hoje',
    pw_business: 'Briefing executivo',
    pw_mentor: 'Reflexão do mentor',
    pw_counselor: 'Seu espaço',
    pw_faith: 'Propósito do dia',
    pw_default: 'Seu dia',
  },
  fr: {
    greeting_morning: 'Bonjour',
    greeting_afternoon: 'Bon après-midi',
    greeting_evening: 'Bonsoir',
    hello: 'Bonjour',
    fallback_name: 'amie',
    ask_leeloo: 'Touche le bouton ou dis "Hey Leeloo"',
    text_fallback_label: 'Tu préfères écrire ?',
    plan_title: 'Votre plan du jour',
    ask_plan: "Demandez à Leeloo ce que vous avez aujourd'hui →",
    actions_title: 'Actions rapides',
    action_agenda: 'Mon agenda',
    action_emails: 'E-mails',
    action_tasks: 'Tâches',
    action_mode: 'Mode Leeloo',
    action_shopping: 'Courses',
    tag_home: 'MAISON',
    tag_work: 'TRAVAIL',
    no_date: 'Sans date',
    write_here: 'Écrivez ici...',
    calendar_title: 'Calendrier',
    agenda_cmd: "qu'est-ce que j'ai aujourd'hui",
    emails_cmd: 'vérifier mes e-mails',
    date_format: 'EEEE d MMMM',
    pw_christian: 'Verset du jour',
    pw_coach: "Défi d'aujourd'hui",
    pw_business: 'Briefing exécutif',
    pw_mentor: 'Réflexion du mentor',
    pw_counselor: 'Votre espace',
    pw_faith: "Objectif du jour",
    pw_default: 'Votre journée',
  },
} as const;

const DATE_LOCALES: Record<string, Locale> = { en: enUS, es, pt: ptBR, fr: frLocale };

const { width: W } = Dimensions.get('window');
const DAY_W = (W - 48) / 7;

// ─── Personality-aware daily widget ───────────────────────────────────────────
const PERSONALITY_WIDGETS: Record<string, { emoji: string; labelKey: keyof typeof UI_STRINGS.en; color: [string, string] }> = {
  christian:  { emoji: '✝️',  labelKey: 'pw_christian', color: ['#6366F1', '#8B5CF6'] },
  coach:      { emoji: '🏆',  labelKey: 'pw_coach',     color: ['#F59E0B', '#EF4444'] },
  business:   { emoji: '📊',  labelKey: 'pw_business',  color: ['#0F172A', '#334155'] },
  mentor:     { emoji: '🧭',  labelKey: 'pw_mentor',    color: ['#0891B2', '#0E7490'] },
  counselor:  { emoji: '💜',  labelKey: 'pw_counselor', color: ['#7C3AED', '#A855F7'] },
  faith:      { emoji: '🌿',  labelKey: 'pw_faith',     color: ['#059669', '#10B981'] },
  default:    { emoji: '⭐',  labelKey: 'pw_default',   color: ['#F07040', '#8375FA'] },
};

const COACH_CHALLENGES: Record<string, string[]> = {
  en: [
    'What is the ONE thing that, if you do it today, makes everything else easier?',
    'Identify your highest-impact task before checking your phone.',
    'Block 90 minutes of deep, uninterrupted work today.',
    'What commitment from last week did you not fulfill? Do it today.',
  ],
  es: [
    '¿Cuál es la UNA cosa que, si la haces hoy, todo lo demás se vuelve más fácil?',
    'Identifica tu tarea de mayor impacto antes de revisar el teléfono.',
    'Bloquea 90 minutos de trabajo profundo sin interrupciones hoy.',
    '¿Qué compromiso de la semana pasada aún no cumpliste? Hazlo hoy.',
  ],
  pt: [
    'Qual é a UMA coisa que, se você fizer hoje, tudo fica mais fácil?',
    'Identifique sua tarefa de maior impacto antes de checar o celular.',
    'Reserve 90 minutos de trabalho profundo sem interrupções hoje.',
    'Que compromisso da semana passada você ainda não cumpriu? Faça hoje.',
  ],
  fr: [
    'Quelle est LA chose que, si vous la faites aujourd\'hui, rend tout le reste plus facile ?',
    'Identifiez votre tâche à plus fort impact avant de vérifier votre téléphone.',
    'Bloquez 90 minutes de travail profond sans interruption aujourd\'hui.',
    'Quel engagement de la semaine dernière n\'avez-vous pas tenu ? Faites-le aujourd\'hui.',
  ],
};

const MENTOR_REFLECTIONS: Record<string, string[]> = {
  en: [
    'Consistent progress beats sporadic perfectionism.',
    'What you sow in your habits, you reap in your results.',
    'Every day is an opportunity to become who you want to be.',
    'Clarity comes from action, not contemplation.',
  ],
  es: [
    'El progreso constante supera al perfeccionismo esporádico.',
    'Lo que siembras en tus hábitos, lo cosechas en tus resultados.',
    'Cada día es una oportunidad de ser quien quieres ser.',
    'La claridad viene de la acción, no de la contemplación.',
  ],
  pt: [
    'O progresso constante supera o perfeccionismo esporádico.',
    'O que você semeia nos seus hábitos, colhe nos seus resultados.',
    'Cada dia é uma oportunidade de ser quem você quer ser.',
    'A clareza vem da ação, não da contemplação.',
  ],
  fr: [
    'Le progrès constant l\'emporte sur le perfectionnisme sporadique.',
    'Ce que vous semez dans vos habitudes, vous le récoltez dans vos résultats.',
    'Chaque jour est une occasion de devenir qui vous voulez être.',
    'La clarté vient de l\'action, pas de la contemplation.',
  ],
};

const FAITH_PURPOSES: Record<string, string[]> = {
  en: [
    'Today you have the opportunity to serve someone unexpectedly.',
    'Every completed task is an act of love toward your family.',
    'Gratitude opens doors that effort alone cannot.',
    'Your full presence is the greatest gift you can give.',
  ],
  es: [
    'Hoy tienes la oportunidad de servir a alguien inesperadamente.',
    'Cada tarea cumplida es un acto de amor hacia tu familia.',
    'La gratitud abre puertas que el esfuerzo solo no puede abrir.',
    'Tu presencia plena es el regalo más grande que puedes dar.',
  ],
  pt: [
    'Hoje você tem a oportunidade de servir alguém inesperadamente.',
    'Cada tarefa cumprida é um ato de amor para com sua família.',
    'A gratidão abre portas que o esforço sozinho não consegue.',
    'Sua presença plena é o maior presente que você pode dar.',
  ],
  fr: [
    'Aujourd\'hui vous avez l\'opportunité de servir quelqu\'un de façon inattendue.',
    'Chaque tâche accomplie est un acte d\'amour envers votre famille.',
    'La gratitude ouvre des portes que l\'effort seul ne peut ouvrir.',
    'Votre présence totale est le plus grand cadeau que vous puissiez offrir.',
  ],
};

const dayIndex = new Date().getDay();

function usePersonalityWidget() {
  const [personality, setPersonality] = useState<string>('default');
  const [verseText, setVerseText] = useState<string>('');
  const [leelooName, setLeelooName] = useState<string>('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    profilesAPI.getMe().then((res: any) => {
      const p = res?.data as any;
      const pers = typeof p?.leeloo_personality === 'string' ? p.leeloo_personality : 'default';
      const name = typeof p?.leeloo_name === 'string' ? p.leeloo_name : '';
      setPersonality(pers);
      setLeelooName(name);
      if (pers === 'christian') {
        verseAPI.daily().then((vRes: any) => {
          const v = vRes?.data;
          const text = typeof v?.verse === 'string' ? v.verse : typeof v?.text === 'string' ? v.text : '';
          const ref = typeof v?.reference === 'string' ? v.reference : '';
          setVerseText(ref ? `"${text}" — ${ref}` : text);
        }).catch(() => {});
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  return { personality, verseText, leelooName, loaded };
}

// ─── Weather types ────────────────────────────────────────────────────────────
type WeatherData = {
  city: string;
  country: string;
  current: {
    temp: number;
    feels_like: number;
    humidity: number;
    condition: string;
    description: string;
    icon: string;
    wind_kph: number;
  };
  today: { temp_min: number; temp_max: number };
  rain_alert: {
    period: string;
    hour: number;
    rain_mm: number;
    message_es: string;
    message_en: string;
    message_pt: string;
    message_fr: string;
  } | null;
};

const WEATHER_ICONS: Record<string, string> = {
  Clear: '☀️', Clouds: '☁️', Rain: '🌧️', Drizzle: '🌦️',
  Thunderstorm: '⛈️', Snow: '❄️', Mist: '🌫️', Fog: '🌫️',
  Haze: '🌫️', Smoke: '🌫️', Dust: '🌪️', Tornado: '🌪️',
};

function useWeather() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  useEffect(() => {
    weatherAPI.get().then((res: any) => {
      const d = res?.data;
      if (d?.ok && d?.weather) setWeather(d.weather);
    }).catch(() => {});
  }, []);
  return weather;
}

// ─── WeatherWidget component ──────────────────────────────────────────────────
function WeatherWidget({ weather, language }: { weather: WeatherData; language: string }) {
  const icon = WEATHER_ICONS[weather.current.condition] ?? '🌡️';
  const rainMsg = weather.rain_alert
    ? (language === 'en' ? weather.rain_alert.message_en
      : language === 'pt' ? weather.rain_alert.message_pt
      : language === 'fr' ? weather.rain_alert.message_fr
      : weather.rain_alert.message_es)
    : null;

  return (
    <View style={ww.card}>
      <View style={ww.left}>
        <Text style={ww.icon}>{icon}</Text>
        <View>
          <Text style={ww.temp}>{weather.current.temp}°</Text>
          <Text style={ww.desc}>{weather.current.description}</Text>
        </View>
      </View>
      <View style={ww.right}>
        <Text style={ww.city}>{weather.city}</Text>
        <Text style={ww.range}>↑{weather.today.temp_max}° ↓{weather.today.temp_min}°</Text>
        <Text style={ww.feels}>
          {language === 'en' ? `Feels ${weather.current.feels_like}°`
            : language === 'pt' ? `Sensação ${weather.current.feels_like}°`
            : language === 'fr' ? `Ressenti ${weather.current.feels_like}°`
            : `Sensación ${weather.current.feels_like}°`}
        </Text>
      </View>
      {!!rainMsg && (
        <View style={ww.rainAlert}>
          <Text style={ww.rainText}>☂️ {rainMsg}</Text>
        </View>
      )}
    </View>
  );
}

const ww = StyleSheet.create({
  card: {
    backgroundColor: '#EEF2FF',
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  icon: { fontSize: 40 },
  temp: { fontSize: 28, fontWeight: '800', color: T.colors.navy, fontFamily: T.fonts.bold },
  desc: { fontSize: 12, color: '#6366F1', fontFamily: T.fonts.regular, textTransform: 'capitalize' },
  right: { alignItems: 'flex-end', gap: 2 },
  city: { fontSize: 13, fontWeight: '700', color: T.colors.navy, fontFamily: T.fonts.bold },
  range: { fontSize: 12, color: T.colors.muted, fontFamily: T.fonts.regular },
  feels: { fontSize: 11, color: T.colors.muted, fontFamily: T.fonts.regular },
  rainAlert: {
    width: '100%',
    backgroundColor: '#DBEAFE',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  rainText: { fontSize: 13, color: '#1D4ED8', fontFamily: T.fonts.regular, lineHeight: 18 },
});

function PersonalityWidget({ personality, verseText, userName, language }: {
  personality: string;
  verseText: string;
  userName: string;
  language: string;
}) {
  const t = UI_STRINGS[language as keyof typeof UI_STRINGS] ?? UI_STRINGS.en;
  const cfg = PERSONALITY_WIDGETS[personality] ?? PERSONALITY_WIDGETS.default;

  const content = (() => {
    const lang = (['en', 'es', 'pt', 'fr'].includes(language) ? language : 'en') as 'en' | 'es' | 'pt' | 'fr';
    if (personality === 'christian') {
      const loading = { en: 'Loading verse...', es: 'Cargando versículo...', pt: 'Carregando versículo...', fr: 'Chargement du verset...' };
      return verseText || loading[lang] || loading.en;
    }
    if (personality === 'coach') {
      const arr = COACH_CHALLENGES[lang] ?? COACH_CHALLENGES.en;
      return arr[dayIndex % arr.length];
    }
    if (personality === 'business') {
      const h = new Date().getHours();
      const shifts = {
        en: [h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening', 'Good'],
        es: [h < 12 ? 'mañana' : h < 18 ? 'tarde' : 'noche', 'Buenos'],
        pt: [h < 12 ? 'manhã' : h < 18 ? 'tarde' : 'noite', 'Bom'],
        fr: [h < 12 ? 'matin' : h < 18 ? 'après-midi' : 'soirée', 'Bonjour'],
      };
      const [shift] = shifts[lang] ?? shifts.en;
      const greet = { en: `${userName ? `${userName}, good` : 'Good'} ${shift}. Optimize now: what's your highest-impact decision?`, es: `${userName ? `${userName}, b` : 'B'}uenas. Optimiza tu ${shift}: define tu próxima decisión de mayor impacto.`, pt: `${userName ? `${userName}, bom` : 'Bom'} ${shift}. Otimize agora: qual é sua decisão de maior impacto?`, fr: `${userName ? `${userName}, bonjour` : 'Bonjour'}. Optimisez votre ${shift} : quelle est votre décision à plus fort impact ?` };
      return greet[lang] ?? greet.en;
    }
    if (personality === 'mentor') {
      const arr = MENTOR_REFLECTIONS[lang] ?? MENTOR_REFLECTIONS.en;
      return arr[dayIndex % arr.length];
    }
    if (personality === 'counselor') {
      const s = { en: "How are you really today? Leeloo is here to listen.", es: '¿Cómo estás hoy realmente? Leeloo está aquí para escucharte.', pt: 'Como você está realmente hoje? Leeloo está aqui para ouvir.', fr: 'Comment allez-vous vraiment aujourd\'hui ? Leeloo est là pour vous écouter.' };
      return s[lang] ?? s.en;
    }
    if (personality === 'faith') {
      const arr = FAITH_PURPOSES[lang] ?? FAITH_PURPOSES.en;
      return arr[dayIndex % arr.length];
    }
    const def = { en: userName ? `Hi ${userName}! What do you want to achieve today?` : 'How can I help you today?', es: userName ? `¡Hola ${userName}! ¿Qué quieres lograr hoy?` : '¿Cómo puedo ayudarte hoy?', pt: userName ? `Olá ${userName}! O que você quer alcançar hoje?` : 'Como posso te ajudar hoje?', fr: userName ? `Bonjour ${userName} ! Que voulez-vous accomplir aujourd'hui ?` : 'Comment puis-je vous aider aujourd\'hui ?' };
    return def[lang] ?? def.en;
  })();

  return (
    <LinearGradient
      colors={cfg.color}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={pw.card}
    >
      <Text style={pw.emoji}>{cfg.emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={pw.label}>{t[cfg.labelKey]}</Text>
        <Text style={pw.content} numberOfLines={3}>{content}</Text>
      </View>
    </LinearGradient>
  );
}

const pw = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  emoji: { fontSize: 28, lineHeight: 36 },
  label: { fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: '600', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.8 },
  content: { fontSize: 14, color: '#fff', lineHeight: 20, fontWeight: '500' },
});

function CalendarStrip() {
  const language = useSettingsStore((s) => s.language);
  const dateLocale = DATE_LOCALES[language] ?? enUS;
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - 3 + i);
    return d;
  });
  const [selected, setSelected] = useState(3);
  return (
    <View style={cs.row}>
      {days.map((d, i) => {
        const isSelected = i === selected;
        const isToday = i === 3;
        return (
          <TouchableOpacity
            key={i}
            style={[cs.dayCell, isSelected && cs.dayCellActive]}
            onPress={() => setSelected(i)}
            activeOpacity={0.7}
          >
            <Text style={[cs.dayName, isSelected && cs.dayTextActive]}>
              {format(d, 'EEE', { locale: dateLocale }).charAt(0).toUpperCase() + format(d, 'EEE', { locale: dateLocale }).slice(1, 3)}
            </Text>
            <Text style={[cs.dayNum, isSelected && cs.dayTextActive]}>{d.getDate()}</Text>
            {isToday && <View style={[cs.dot, isSelected && cs.dotActive]} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const cs = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4, paddingHorizontal: 4 },
  dayCell: {
    flex: 1, alignItems: 'center', paddingVertical: 10,
    borderRadius: 12, gap: 4,
  },
  dayCellActive: {
    backgroundColor: T.colors.navy,
  },
  dayName: { fontSize: 11, color: '#9CA3AF', fontFamily: T.fonts.semiBold },
  dayNum: { fontSize: 16, fontWeight: '700', color: T.colors.navy, fontFamily: T.fonts.bold },
  dayTextActive: { color: T.colors.white },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: T.colors.purple },
  dotActive: { backgroundColor: T.colors.peach },
});

export default function HomeScreen() {
  const transcription = useVoiceStore((s) => s.transcription);
  const response = useVoiceStore((s) => s.response);
  const isProcessing = useVoiceStore((s) => s.isProcessing);
  const lastError = useVoiceStore((s) => s.lastError);
  const sendText = useVoiceStore((s) => s.sendText);
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);
  const isListening = useVoiceStore((s) => s.isListening);
  const isConversationMode = useVoiceStore((s) => s.isConversationMode);
  const session = useAuthStore((s) => s.session);
  const hydrateTasks = useTasksStore((s) => s.hydrate);
  const tasks = useTasksStore((s) => s.tasks);
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const { personality, verseText, leelooName } = usePersonalityWidget();
  const language = useSettingsStore((s) => s.language);
  const weather = useWeather();
  const t = UI_STRINGS[language] ?? UI_STRINGS.en;
  const dateLocale = DATE_LOCALES[language] ?? enUS;
  const [wakeActive, setWakeActive] = useState(false);

  // ── LeelooEars: always-listening wake word detection ──────────────────────
  useEffect(() => {
    if (!session) return;

    wakeWordService.start({
      language,
      onDetected: () => {
        // Stop the wake word loop and start full conversation recording
        wakeWordService.pause();
        useVoiceStore.getState().startListeningFromWakeWord();
      },
    });
    setWakeActive(true);

    return () => {
      wakeWordService.stop();
      setWakeActive(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // ── Deep link handler: leeloo://voice (desde notificación/shortcut) ─────────
  useEffect(() => {
    const handleUrl = (event: { url: string }) => {
      if (event.url === 'leeloo://voice' || event.url?.endsWith('//voice')) {
        // Activar escucha directamente igual que si el usuario presionara el botón
        useVoiceStore.getState().startListeningFromWakeWord?.();
      }
    };
    // Maneja el caso de la app ya abierta
    const sub = Linking.addEventListener('url', handleUrl);
    // Maneja el caso de la app abierta desde cold start
    Linking.getInitialURL().then((url) => { if (url) handleUrl({ url }); }).catch(() => {});
    return () => sub.remove();
  }, []);

  // Pause/resume wake word detector based on voice activity.
  // In conversation mode, the voice store handles its own auto-continue loop,
  // so we pause the wake word detector until conversation mode exits.
  useEffect(() => {
    if (!wakeActive) return;

    const busy = isListening || isProcessing || isSpeaking || isConversationMode;
    if (busy) {
      wakeWordService.pause();
    } else {
      // Idle AND out of conversation mode → resume passive wake word detection
      const t = setTimeout(() => wakeWordService.resume(), 1000);
      return () => clearTimeout(t);
    }
  }, [isListening, isProcessing, isSpeaking, isConversationMode, wakeActive]);

  useEffect(() => { void hydrateTasks(); }, [hydrateTasks]);

  // ── Agenda proactiva: habla el resumen del día la primera vez que abre ────
  useEffect(() => {
    if (!session) return;
    const todayKey = new Date().toISOString().slice(0, 10);
    let cancelled = false;
    AsyncStorage.getItem('leeloo_agenda_date').then((stored) => {
      if (cancelled || stored === todayKey) return;
      const timer = setTimeout(async () => {
        if (cancelled) return;
        await AsyncStorage.setItem('leeloo_agenda_date', todayKey);
        // Build agenda message — include rain alert if available
        let agendaMsg = t.agenda_cmd;
        if (weather?.rain_alert) {
          const rainMsg = language === 'en' ? weather.rain_alert.message_en
            : language === 'pt' ? weather.rain_alert.message_pt
            : language === 'fr' ? weather.rain_alert.message_fr
            : weather.rain_alert.message_es;
          // Append weather reminder to the agenda query so the AI includes it
          const weatherNote = language === 'en'
            ? ` Also mention: ${rainMsg}`
            : language === 'pt'
            ? ` Também mencione: ${rainMsg}`
            : language === 'fr'
            ? ` Mentionnez aussi: ${rainMsg}`
            : ` Además menciona: ${rainMsg}`;
          agendaMsg = t.agenda_cmd + weatherNote;
        }
        sendText(agendaMsg);
      }, 4000);
      return () => clearTimeout(timer);
    }).catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, weather]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return t.greeting_morning;
    if (h < 18) return t.greeting_afternoon;
    return t.greeting_evening;
  }, [t]);

  const userMetadata = ((session as any)?.user?.user_metadata || undefined) as
    | Record<string, unknown> | undefined;
  const clerkName =
    (typeof userMetadata?.full_name === 'string' && userMetadata.full_name.split(' ')[0]) ||
    (typeof userMetadata?.name === 'string' && userMetadata.name.split(' ')[0]) ||
    '';
  // Use Leeloo name from profile if set, else fallback to Clerk name
  const name = leelooName || clerkName || t.fallback_name;

  const upcoming = useMemo(() => {
    return (tasks || [])
      .filter((t) => String(t.status || '') !== 'done')
      .sort((a, b) => {
        const aMs = a.due_at ? new Date(a.due_at).getTime() : Infinity;
        const bMs = b.due_at ? new Date(b.due_at).getTime() : Infinity;
        return aMs - bMs;
      })
      .slice(0, 3);
  }, [tasks]);

  const pendingCount = useMemo(
    () => (tasks || []).filter((t) => String(t.status || '') === 'pending_approval').length,
    [tasks],
  );

  const handleSend = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await sendText(text);
  };

  const todayStr = format(new Date(), t.date_format, { locale: dateLocale });

  return (
    <View style={{ flex: 1, backgroundColor: T.colors.cream }}>
      <WaveBackground opacity={0.055} cellSize={38} />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* ── HEADER ─────────────────────────────────── */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerDate}>{todayStr}</Text>
              <Text style={styles.headerName}>{t.hello}{name ? `, ${name}` : ''}</Text>
            </View>
            <TouchableOpacity style={styles.searchBtn}>
              <Search size={20} color={T.colors.navy} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <ChildRequestBanner
            count={pendingCount}
            onPress={() => router.push('/(tabs)/dashboard?tab=approvals')}
          />

          {/* ── PERSONALITY WIDGET ────────────────────── */}
          <PersonalityWidget personality={personality} verseText={verseText} userName={name} language={language} />

          {/* ── WEATHER WIDGET ────────────────────────── */}
          {!!weather && <WeatherWidget weather={weather} language={language} />}

          {/* ── VOICE + GREETING CARD ─────────────────── */}
          <LinearGradient
            colors={['#F07040', '#C4507A', '#8375FA']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.greetCard}
          >
            <WaveBackground opacity={0.12} cellSize={32} />
            <Text style={styles.greetTitle}>{greeting}, {name}</Text>
            <Text style={styles.greetSub}>{t.ask_leeloo}</Text>

            {/* Text fallback — clearly labeled so user knows it's an option */}
            <Text style={styles.textFallbackLabel}>{t.text_fallback_label}</Text>
            <View style={styles.chatRow}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={t.write_here}
                placeholderTextColor="rgba(255,255,255,0.6)"
                editable={!isProcessing}
                style={styles.chatInput}
                returnKeyType="send"
                onSubmitEditing={handleSend}
              />
              <TouchableOpacity
                onPress={handleSend}
                disabled={isProcessing || !draft.trim()}
                style={[styles.sendBtn, (isProcessing || !draft.trim()) && { opacity: 0.5 }]}
              >
                <Text style={styles.sendBtnText}>{isProcessing ? '…' : '→'}</Text>
              </TouchableOpacity>
            </View>

            {!!lastError && (
              <Text style={styles.errorText} numberOfLines={2}>{lastError}</Text>
            )}
            {!!transcription && (
              <Text style={styles.transcriptText}>"{transcription}"</Text>
            )}
          </LinearGradient>

          {/* ── VOICE BUTTON ──────────────────────────── */}
          <VoiceButton alwaysListening={wakeActive} />

          {/* ── AI RESPONSE ───────────────────────────── */}
          {!!response && (
            <View style={styles.responseCard}>
              <Text style={styles.responseText}>{response}</Text>
            </View>
          )}

          {/* ── CALENDAR STRIP ────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t.calendar_title}</Text>
            <CalendarStrip />
          </View>

          {/* ── TU PLAN HOY ───────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t.plan_title}</Text>
            {upcoming.length === 0 ? (
              <TouchableOpacity
                style={styles.planEmpty}
                onPress={() => sendText('what do I have today')}
                activeOpacity={0.8}
              >
                <Text style={styles.planEmptyText}>{t.ask_plan}</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ gap: 10 }}>
                {upcoming.map((task) => {
                  const isHome = String((task as any).category || task.metadata?.category || '').toLowerCase().includes('hogar') ||
                    String((task as any).tags || '').toLowerCase().includes('hogar');
                  return (
                    <View key={task.id} style={styles.planCard}>
                      <View style={[styles.planCardTag, { backgroundColor: isHome ? '#FEF3C7' : '#EDE9FE' }]}>
                        <Text style={{ fontSize: 10, color: isHome ? '#92400E' : '#5B21B6', fontWeight: '700' }}>
                          {isHome ? t.tag_home : t.tag_work}
                        </Text>
                      </View>
                      <View style={styles.planCardLeft}>
                        <Text style={styles.planCardTitle}>{task.title}</Text>
                        <Text style={styles.planCardSub}>
                          {task.due_at ? new Date(task.due_at).toLocaleDateString(language === 'pt' ? 'pt-BR' : language, { weekday: 'short', day: 'numeric', month: 'short' }) : t.no_date}
                        </Text>
                      </View>
                      <Text style={styles.planCardDots}>⋮</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* ── QUICK ACTIONS ─────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t.actions_title}</Text>
            <View style={styles.quickActions}>
              {[
                { emoji: '🗓️', label: t.action_agenda, action: () => sendText(t.agenda_cmd) },
                { emoji: '📧', label: t.action_emails, action: () => sendText(t.emails_cmd) },
                { emoji: '✅', label: t.action_tasks, action: () => router.push('/(tabs)/tasks') },
                { emoji: '🛒', label: t.action_shopping, action: () => router.push('/shopping') },
              ].map((a) => (
                <TouchableOpacity key={a.label} style={styles.actionCard} onPress={a.action} activeOpacity={0.75}>
                  <Text style={styles.actionEmoji}>{a.emoji}</Text>
                  <Text style={styles.actionLabel}>{a.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingBottom: 32 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 12,
  },
  headerDate: {
    fontSize: 13,
    color: '#9CA3AF',
    fontFamily: T.fonts.regular,
    textTransform: 'capitalize',
  },
  headerName: {
    fontSize: 26,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    color: T.colors.navy,
  },
  searchBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: T.colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: T.colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  greetCard: {
    borderRadius: T.radius.lg,
    padding: 20,
    marginBottom: 12,
    overflow: 'hidden',
    minHeight: 130,
    gap: 6,
  },
  greetTitle: {
    fontSize: 26,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    color: T.colors.white,
  },
  greetSub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    fontFamily: T.fonts.regular,
    marginBottom: 6,
    fontWeight: '500',
  },
  textFallbackLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    fontFamily: T.fonts.regular,
    marginBottom: 4,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  chatRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  chatInput: {
    flex: 1,
    height: 40,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    paddingHorizontal: 12,
    color: T.colors.white,
    fontSize: 14,
    fontFamily: T.fonts.regular,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: {
    color: T.colors.white,
    fontSize: 18,
    fontWeight: '700',
  },
  errorText: {
    color: 'rgba(255,220,220,0.9)',
    fontSize: 12,
    fontFamily: T.fonts.regular,
    marginTop: 4,
  },
  transcriptText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: 4,
  },
  responseCard: {
    backgroundColor: T.colors.white,
    borderRadius: T.radius.md,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#EDE9F8',
    shadowColor: T.colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  responseText: {
    fontSize: 14,
    color: T.colors.black,
    lineHeight: 20,
    fontFamily: T.fonts.regular,
  },
  section: {
    marginTop: 24,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    color: T.colors.navy,
  },
  planEmpty: {
    backgroundColor: '#F0EDFF',
    borderRadius: T.radius.md,
    padding: 16,
  },
  planEmptyText: {
    color: '#8F8BB8',
    fontSize: 14,
    fontFamily: T.fonts.regular,
  },
  planCard: {
    backgroundColor: '#F0EDFF',
    borderRadius: T.radius.md,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  planCardTag: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    marginRight: 10,
    alignSelf: 'flex-start',
  },
  planCardLeft: { flex: 1, gap: 4 },
  planCardTitle: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: T.fonts.semiBold,
    color: T.colors.navy,
  },
  planCardSub: {
    fontSize: 12,
    color: '#8F8BB8',
    fontFamily: T.fonts.regular,
    textTransform: 'capitalize',
  },
  planCardDots: {
    fontSize: 20,
    color: '#B0AACC',
  },
  quickActions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionCard: {
    flex: 1,
    backgroundColor: T.colors.white,
    borderRadius: T.radius.md,
    padding: 14,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#EDE9F8',
    shadowColor: T.colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  actionEmoji: { fontSize: 26 },
  actionLabel: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: T.fonts.semiBold,
    color: T.colors.navy,
    textAlign: 'center',
  },
});
