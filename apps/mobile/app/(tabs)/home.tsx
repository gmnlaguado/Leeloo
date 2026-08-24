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

const { width: W } = Dimensions.get('window');
const DAY_W = (W - 48) / 7;

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
  const { transcription, response, isProcessing, lastError, sendText } = useVoiceStore();
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);
  const session = useAuthStore((s) => s.session);
  const hydrateTasks = useTasksStore((s) => s.hydrate);
  const tasks = useTasksStore((s) => s.tasks);
  const router = useRouter();
  const [draft, setDraft] = useState('');

  useEffect(() => { hydrateTasks(); }, [hydrateTasks]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const userMetadata = ((session as any)?.user?.user_metadata || undefined) as
    | Record<string, unknown> | undefined;
  const name =
    (typeof userMetadata?.full_name === 'string' && userMetadata.full_name.split(' ')[0]) ||
    (typeof userMetadata?.name === 'string' && userMetadata.name.split(' ')[0]) ||
    'Alice';

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
              <Text style={styles.headerName}>Hello {name}</Text>
            </View>
            <TouchableOpacity style={styles.searchBtn}>
              <Search size={20} color={T.colors.navy} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <ChildRequestBanner
            count={pendingCount}
            onPress={() => router.push('/(tabs)/dashboard?tab=approvals')}
          />

          {/* ── VOICE + GREETING CARD ─────────────────── */}
          <LinearGradient
            colors={['#F07040', '#C4507A', '#8375FA']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.greetCard}
          >
            <WaveBackground opacity={0.12} cellSize={32} />
            <Text style={styles.greetTitle}>{greeting}</Text>
            <Text style={styles.greetSub}>How can I help today?</Text>

            {/* Chat input inside card */}
            <View style={styles.chatRow}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Write here..."
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
            <Text style={styles.sectionTitle}>Calendar</Text>
            <CalendarStrip />
          </View>

          {/* ── YOUR PLAN ─────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your Plan</Text>
            {upcoming.length === 0 ? (
              <View style={styles.planEmpty}>
                <Text style={styles.planEmptyText}>How can I help today?</Text>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {upcoming.map((t) => (
                  <View key={t.id} style={styles.planCard}>
                    <View style={styles.planCardLeft}>
                      <Text style={styles.planCardTitle}>{t.title}</Text>
                      <Text style={styles.planCardSub}>
                        {t.due_at ? new Date(t.due_at).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }) : 'Sin fecha'}
                      </Text>
                    </View>
                    <Text style={styles.planCardDots}>⋮</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* ── QUICK ACTIONS ─────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Acciones rápidas</Text>
            <View style={styles.quickActions}>
              {[
                { emoji: '📧', label: 'Correos', action: () => sendText('revisa mis correos') },
                { emoji: '📅', label: 'Agenda', action: () => router.push('/(tabs)/calendar') },
                { emoji: '✅', label: 'Tareas', action: () => router.push('/(tabs)/tasks') },
                { emoji: '🧠', label: 'Personalidad', action: () => router.push('/settings/personality') },
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
