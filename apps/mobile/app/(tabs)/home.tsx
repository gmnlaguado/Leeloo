import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
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
import { es } from 'date-fns/locale';
import { profilesAPI, verseAPI } from '@/lib/api';
import { useSettingsStore } from '@/store/settings';
import { deviceLogger } from '@/services/device-logger';

// ─── Minimal UI translations (4 languages) ────────────────────────────────────
const UI_STRINGS = {
  en: {
    greeting_morning: 'Good morning',
    greeting_afternoon: 'Good afternoon',
    greeting_evening: 'Good evening',
    ask_leeloo: 'How can I help you today?',
    plan_title: "Today's plan",
    ask_plan: 'Ask Leeloo what you have today →',
    actions_title: 'Quick actions',
    action_agenda: 'My agenda',
    action_emails: 'Emails',
    action_tasks: 'Tasks',
    action_mode: 'Leeloo mode',
    tag_home: 'HOME',
    tag_work: 'WORK',
    no_date: 'No date',
    write_here: 'Write here...',
    calendar_title: 'Calendar',
  },
  es: {
    greeting_morning: 'Buenos días',
    greeting_afternoon: 'Buenas tardes',
    greeting_evening: 'Buenas noches',
    ask_leeloo: '¿En qué te ayudo hoy?',
    plan_title: 'Tu plan de hoy',
    ask_plan: 'Pregúntale a Leeloo qué tienes hoy →',
    actions_title: 'Acciones rápidas',
    action_agenda: 'Mi agenda',
    action_emails: 'Correos',
    action_tasks: 'Tareas',
    action_mode: 'Modo Leeloo',
    tag_home: 'HOGAR',
    tag_work: 'TRABAJO',
    no_date: 'Sin fecha',
    write_here: 'Escribe aquí...',
    calendar_title: 'Calendario',
  },
  pt: {
    greeting_morning: 'Bom dia',
    greeting_afternoon: 'Boa tarde',
    greeting_evening: 'Boa noite',
    ask_leeloo: 'Como posso te ajudar hoje?',
    plan_title: 'Seu plano de hoje',
    ask_plan: 'Pergunte à Leeloo o que você tem hoje →',
    actions_title: 'Ações rápidas',
    action_agenda: 'Minha agenda',
    action_emails: 'E-mails',
    action_tasks: 'Tarefas',
    action_mode: 'Modo Leeloo',
    tag_home: 'CASA',
    tag_work: 'TRABALHO',
    no_date: 'Sem data',
    write_here: 'Escreva aqui...',
    calendar_title: 'Calendário',
  },
  fr: {
    greeting_morning: 'Bonjour',
    greeting_afternoon: 'Bon après-midi',
    greeting_evening: 'Bonsoir',
    ask_leeloo: 'Comment puis-je t\'aider aujourd\'hui ?',
    plan_title: 'Votre plan du jour',
    ask_plan: 'Demandez à Leeloo ce que vous avez aujourd\'hui →',
    actions_title: 'Actions rapides',
    action_agenda: 'Mon agenda',
    action_emails: 'E-mails',
    action_tasks: 'Tâches',
    action_mode: 'Mode Leeloo',
    tag_home: 'MAISON',
    tag_work: 'TRAVAIL',
    no_date: 'Sans date',
    write_here: 'Écrivez ici...',
    calendar_title: 'Calendrier',
  },
} as const;

const { width: W } = Dimensions.get('window');
const DAY_W = (W - 48) / 7;

// ─── Personality-aware daily widget ───────────────────────────────────────────
const PERSONALITY_WIDGETS: Record<string, { emoji: string; label: string; color: [string, string] }> = {
  christian:  { emoji: '✝️',  label: 'Versículo del día',     color: ['#6366F1', '#8B5CF6'] },
  coach:      { emoji: '🏆',  label: 'Desafío de hoy',        color: ['#F59E0B', '#EF4444'] },
  business:   { emoji: '📊',  label: 'Briefing ejecutivo',    color: ['#0F172A', '#334155'] },
  mentor:     { emoji: '🧭',  label: 'Reflexión del mentor',  color: ['#0891B2', '#0E7490'] },
  counselor:  { emoji: '💜',  label: 'Tu espacio',            color: ['#7C3AED', '#A855F7'] },
  faith:      { emoji: '🌿',  label: 'Propósito del día',     color: ['#059669', '#10B981'] },
  default:    { emoji: '⭐',  label: 'Tu día',                color: ['#F07040', '#8375FA'] },
};

const COACH_CHALLENGES = [
  '¿Cuál es el UNA cosa que, si la haces hoy, todo lo demás se vuelve más fácil?',
  'Identifica tu tarea de mayor impacto antes de revisar el teléfono.',
  'Bloquea 90 minutos de trabajo profundo sin interrupciones hoy.',
  '¿Qué compromiso de la semana pasada aún no cumpliste? Hazlo hoy.',
];

const MENTOR_REFLECTIONS = [
  'El progreso constante supera al perfeccionismo esporádico.',
  'Lo que siembras en tus hábitos, lo cosechas en tus resultados.',
  'Cada día es una oportunidad de ser quien quieres ser.',
  'La claridad viene de la acción, no de la contemplación.',
];

const FAITH_PURPOSES = [
  'Hoy tienes la oportunidad de servir a alguien inesperadamente.',
  'Cada tarea cumplida es un acto de amor hacia tu familia.',
  'La gratitud abre puertas que el esfuerzo solo no puede abrir.',
  'Tu presencia plena es el regalo más grande que puedes dar.',
];

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

function PersonalityWidget({ personality, verseText, userName }: {
  personality: string;
  verseText: string;
  userName: string;
}) {
  const cfg = PERSONALITY_WIDGETS[personality] ?? PERSONALITY_WIDGETS.default;

  const content = (() => {
    if (personality === 'christian') {
      return verseText || 'Cargando versículo...';
    }
    if (personality === 'coach') {
      return COACH_CHALLENGES[dayIndex % COACH_CHALLENGES.length];
    }
    if (personality === 'business') {
      const h = new Date().getHours();
      const shift = h < 12 ? 'mañana' : h < 18 ? 'tarde' : 'noche';
      return `${userName ? `${userName}, b` : 'B'}uenas. Optimiza tu ${shift}: define tu próxima decisión de mayor impacto.`;
    }
    if (personality === 'mentor') {
      return MENTOR_REFLECTIONS[dayIndex % MENTOR_REFLECTIONS.length];
    }
    if (personality === 'counselor') {
      return '¿Cómo estás hoy realmente? Leeloo está aquí para escucharte.';
    }
    if (personality === 'faith') {
      return FAITH_PURPOSES[dayIndex % FAITH_PURPOSES.length];
    }
    return userName ? `¡Hola ${userName}! ¿Qué quieres lograr hoy?` : '¿Cómo puedo ayudarte hoy?';
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
        <Text style={pw.label}>{cfg.label}</Text>
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
              {format(d, 'EEE', { locale: es }).charAt(0).toUpperCase() + format(d, 'EEE', { locale: es }).slice(1, 3)}
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
  deviceLogger.log('[Home] HomeScreen mounting');
  const { transcription, response, isProcessing, lastError, sendText } = useVoiceStore();
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);
  const session = useAuthStore((s) => s.session);
  const hydrateTasks = useTasksStore((s) => s.hydrate);
  const tasks = useTasksStore((s) => s.tasks);
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const { personality, verseText, leelooName } = usePersonalityWidget();
  const language = useSettingsStore((s) => s.language);
  const t = UI_STRINGS[language] ?? UI_STRINGS.en;

  useEffect(() => { void hydrateTasks(); }, [hydrateTasks]);

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
  const name = leelooName || clerkName || 'amiga';

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

  const todayStr = format(new Date(), "EEEE d 'de' MMMM", { locale: es });

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
              <Text style={styles.headerName}>Hola, {name}</Text>
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
          <PersonalityWidget personality={personality} verseText={verseText} userName={name} />

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

            {/* Chat input inside card */}
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
          <VoiceButton />

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
                  const isHome = String(task.category || task.metadata?.category || '').toLowerCase().includes('hogar') ||
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
                          {task.due_at ? new Date(task.due_at).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }) : t.no_date}
                        </Text>
                      </View>
                      <Text style={styles.planCardDots}>⋮</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* ── ACCIONES RÁPIDAS ──────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Acciones rápidas</Text>
            <View style={styles.quickActions}>
              {[
                { emoji: '🗓️', label: 'Mi agenda', action: () => sendText('qué tengo para hoy') },
                { emoji: '📧', label: 'Correos', action: () => sendText('revisa mis correos') },
                { emoji: '✅', label: 'Tareas', action: () => router.push('/(tabs)/tasks') },
                { emoji: '🧠', label: 'Modo Leeloo', action: () => router.push('/settings/personality') },
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
    color: 'rgba(255,255,255,0.8)',
    fontFamily: T.fonts.regular,
    marginBottom: 10,
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
