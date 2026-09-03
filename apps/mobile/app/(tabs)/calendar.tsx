import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { WaveBackground } from '@/components/WaveBackground';
import { T } from '@/lib/theme';
import { calendarAPI, integrationsAPI } from '@/lib/api';

type CalendarEvent = {
  id: string;
  title: string;
  // API returns start_at / end_at (DB column names)
  start_at: string | null;
  end_at: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  location?: string;
  description?: string;
  notes?: string;
};

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function formatTime(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

export default function CalendarScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [syncing, setSyncing] = useState(false);
  const [hasIntegration, setHasIntegration] = useState(false);

  const today = new Date();
  const weekDays = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - 2 + i);
    return d;
  });

  useEffect(() => { loadData(selectedDate); }, [selectedDate]);

  // Refetch when coming back to this tab so voice-created events appear
  useFocusEffect(useCallback(() => { loadData(selectedDate); }, [selectedDate]));

  const loadData = async (forDate: Date) => {
    setLoading(true);
    try {
      const intRes = await integrationsAPI.getIntegrations().catch(() => null);
      const intData = intRes?.data as any;
      // API returns { integrations: [{provider,...}] } — not a flat .connected array
      const rows: Array<{ provider: string }> = Array.isArray(intData?.integrations)
        ? intData.integrations
        : Array.isArray(intData?.connected)
          ? (intData.connected as string[]).map((p: string) => ({ provider: p }))
          : [];
      setHasIntegration(rows.length > 0);

      // API endpoint: GET /calendar/events?day=YYYY-MM-DD returns { events: [...] }
      const dayStr = forDate.toLocaleDateString('en-CA'); // YYYY-MM-DD
      const res = await calendarAPI.getEventsForDay(dayStr);
      const data = Array.isArray((res.data as any)?.events)
        ? (res.data as any).events
        : Array.isArray(res.data) ? res.data : [];
      setEvents(data);
    } catch {
      // no events
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await integrationsAPI.syncGoogleCalendar().catch(() => {});
      await integrationsAPI.syncMicrosoftCalendar().catch(() => {});
      await loadData(selectedDate);
      Alert.alert('Sincronizado', 'Tu calendario está actualizado.');
    } catch {
      Alert.alert('Error', 'No se pudo sincronizar.');
    } finally {
      setSyncing(false);
    }
  };

  // API uses start_at / end_at; older shape may use starts_at / ends_at — support both
  const eventStartAt = (e: CalendarEvent) => e.start_at || e.starts_at || null;
  const eventEndAt = (e: CalendarEvent) => e.end_at || e.ends_at || null;

  // Events are already filtered to selectedDate by the API; filter again as a safety net
  const dayEvents = events.filter((e) => {
    const s = eventStartAt(e);
    if (!s) return true; // all-day events with no start_at — include them
    try { return isSameDay(new Date(s), selectedDate); } catch { return false; }
  });

  return (
    <View style={{ flex: 1, backgroundColor: T.colors.cream }}>
      <WaveBackground opacity={0.055} cellSize={38} />
      <SafeAreaView style={{ flex: 1 }}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.monthYear}>
              {MONTHS[selectedDate.getMonth()]} {selectedDate.getFullYear()}
            </Text>
            <Text style={s.pageTitle}>Agenda</Text>
          </View>
          <TouchableOpacity
            style={[s.syncBtn, syncing && s.disabled]}
            onPress={hasIntegration ? handleSync : () => router.push('/settings/integrations')}
            disabled={syncing}
          >
            {syncing ? (
              <ActivityIndicator color={T.colors.purple} size="small" />
            ) : (
              <Text style={s.syncBtnText}>{hasIntegration ? '🔄 Sync' : '🔗 Conectar'}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Day strip */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.dayStrip}
        >
          {weekDays.map((d, i) => {
            const isSelected = isSameDay(d, selectedDate);
            const isToday = isSameDay(d, today);
            const hasEv = events.some((e) => { const s = eventStartAt(e); return !!s && isSameDay(new Date(s), d); });
            return (
              <TouchableOpacity
                key={i}
                style={[s.dayCell, isSelected && s.dayCellActive]}
                onPress={() => setSelectedDate(new Date(d))}
                activeOpacity={0.7}
              >
                <Text style={[s.dayName, isSelected && s.dayTextActive]}>{DAYS[d.getDay()]}</Text>
                <Text style={[s.dayNum, isSelected && s.dayTextActive, isToday && !isSelected && s.dayNumToday]}>
                  {d.getDate()}
                </Text>
                {hasEv && <View style={[s.eventDot, isSelected && s.eventDotActive]} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Events list */}
        <ScrollView style={s.eventList} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <Text style={s.selectedLabel}>
            {DAYS[selectedDate.getDay()]}, {selectedDate.getDate()} de{' '}
            {MONTHS[selectedDate.getMonth()]}
            {isSameDay(selectedDate, today) ? '  · Hoy' : ''}
          </Text>

          {loading ? (
            <ActivityIndicator color={T.colors.purple} style={{ marginTop: 40 }} />
          ) : dayEvents.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyEmoji}>📭</Text>
              <Text style={s.emptyTitle}>Sin eventos</Text>
              <Text style={s.emptySub}>
                {hasIntegration
                  ? 'No tienes nada agendado para este día.'
                  : 'Conecta tu Google Calendar para ver tus eventos aquí.'}
              </Text>
              {!hasIntegration && (
                <TouchableOpacity
                  style={s.connectBtn}
                  onPress={() => router.push('/settings/integrations')}
                >
                  <LinearGradient
                    colors={['#8375FA', '#2D266C']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={s.connectBtnGradient}
                  >
                    <Text style={s.connectBtnText}>Conectar calendario →</Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              {dayEvents.map((event) => (
                <View key={event.id} style={s.eventCard}>
                  <View style={s.eventTimeCol}>
                    <Text style={s.eventTimeText}>{formatTime(eventStartAt(event))}</Text>
                    {eventEndAt(event) && <Text style={s.eventTimeEnd}>{formatTime(eventEndAt(event))}</Text>}
                  </View>
                  <View style={s.eventBar} />
                  <View style={s.eventInfo}>
                    <Text style={s.eventTitle}>{event.title}</Text>
                    {!!event.location && <Text style={s.eventMeta}>📍 {event.location}</Text>}
                    {!!(event.description || event.notes) && (
                      <Text style={s.eventMeta} numberOfLines={2}>{event.description || event.notes}</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  monthYear: {
    fontSize: 13,
    color: T.colors.muted,
    fontFamily: T.fonts.regular,
  },
  pageTitle: {
    fontSize: 32,
    fontWeight: '800',
    fontFamily: T.fonts.bold,
    color: T.colors.navy,
  },
  syncBtn: {
    backgroundColor: T.colors.white,
    borderRadius: T.radius.md,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: T.colors.border,
    minWidth: 88,
    alignItems: 'center',
    shadowColor: T.colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  syncBtnText: {
    color: T.colors.navy,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: T.fonts.semiBold,
  },
  dayStrip: { paddingHorizontal: 16, gap: 6, paddingBottom: 12 },
  dayCell: {
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: T.radius.md,
    minWidth: 50,
    gap: 4,
  },
  dayCellActive: { backgroundColor: T.colors.navy },
  dayName: {
    fontSize: 11,
    color: T.colors.muted,
    fontFamily: T.fonts.semiBold,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  dayNum: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    color: T.colors.navy,
  },
  dayTextActive: { color: T.colors.white },
  dayNumToday: { color: T.colors.purple },
  eventDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: T.colors.purple },
  eventDotActive: { backgroundColor: T.colors.peach },
  eventList: { flex: 1 },
  selectedLabel: {
    fontSize: 14,
    color: '#8F8BB8',
    fontFamily: T.fonts.semiBold,
    fontWeight: '600',
    marginBottom: 16,
    textTransform: 'capitalize',
  },
  empty: { alignItems: 'center', paddingTop: 40, gap: 10 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    color: T.colors.navy,
  },
  emptySub: {
    fontSize: 14,
    color: T.colors.muted,
    textAlign: 'center',
    lineHeight: 20,
    fontFamily: T.fonts.regular,
    maxWidth: 260,
  },
  connectBtn: {
    marginTop: 8,
    borderRadius: T.radius.md,
    overflow: 'hidden',
    shadowColor: T.colors.purple,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  connectBtnGradient: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  connectBtnText: {
    color: T.colors.white,
    fontWeight: '700',
    fontSize: 14,
    fontFamily: T.fonts.bold,
  },
  eventCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  eventTimeCol: { width: 50, alignItems: 'flex-end', paddingTop: 4 },
  eventTimeText: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    color: T.colors.navy,
  },
  eventTimeEnd: {
    fontSize: 11,
    color: T.colors.muted,
    fontFamily: T.fonts.regular,
  },
  eventBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: T.colors.purple,
    minHeight: 40,
    marginTop: 4,
  },
  eventInfo: {
    flex: 1,
    backgroundColor: T.colors.white,
    borderRadius: T.radius.md,
    padding: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: T.colors.border,
    shadowColor: T.colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  eventTitle: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    color: T.colors.navy,
  },
  eventMeta: {
    fontSize: 12,
    color: T.colors.muted,
    fontFamily: T.fonts.regular,
  },
  disabled: { opacity: 0.5 },
});
