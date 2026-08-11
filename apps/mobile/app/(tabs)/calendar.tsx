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
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { calendarAPI, integrationsAPI } from '@/lib/api';

type CalendarEvent = {
  id: string;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  location?: string;
  description?: string;
};

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function formatTime(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
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

  // Build 7-day strip starting from today - 2
  const weekDays = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - 2 + i);
    return d;
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Check integrations
      const intRes = await integrationsAPI.getIntegrations().catch(() => null);
      const connected: string[] = Array.isArray((intRes?.data as any)?.connected)
        ? (intRes?.data as any).connected : [];
      setHasIntegration(connected.length > 0);

      // Load events for the next 30 days
      const start = new Date();
      start.setDate(start.getDate() - 7);
      const end = new Date();
      end.setDate(end.getDate() + 30);
      const res = await calendarAPI.getEvents(start.toISOString(), end.toISOString());
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
      await loadData();
      Alert.alert('✅ Sincronizado', 'Tu calendario está actualizado.');
    } catch {
      Alert.alert('Error', 'No se pudo sincronizar.');
    } finally {
      setSyncing(false);
    }
  };

  const dayEvents = events.filter((e) => {
    if (!e.starts_at) return false;
    return isSameDay(new Date(e.starts_at), selectedDate);
  });

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.monthYear}>
            {MONTHS[selectedDate.getMonth()]} {selectedDate.getFullYear()}
          </Text>
          <Text style={styles.pageTitle}>Agenda</Text>
        </View>
        <TouchableOpacity
          style={[styles.syncBtn, syncing && styles.disabled]}
          onPress={hasIntegration ? handleSync : () => router.push('/settings/integrations')}
          disabled={syncing}
        >
          {syncing ? (
            <ActivityIndicator color="#7C3AED" size="small" />
          ) : (
            <Text style={styles.syncBtnText}>{hasIntegration ? '🔄 Sync' : '🔗 Conectar'}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Day strip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.dayStrip}
      >
        {weekDays.map((d, i) => {
          const isSelected = isSameDay(d, selectedDate);
          const isToday = isSameDay(d, today);
          const hasEvents = events.some(
            (e) => e.starts_at && isSameDay(new Date(e.starts_at), d),
          );
          return (
            <TouchableOpacity
              key={i}
              style={[styles.dayCell, isSelected && styles.dayCellActive]}
              onPress={() => setSelectedDate(new Date(d))}
            >
              <Text style={[styles.dayName, isSelected && styles.dayNameActive]}>
                {DAYS[d.getDay()]}
              </Text>
              <Text style={[styles.dayNum, isSelected && styles.dayNumActive, isToday && !isSelected && styles.dayNumToday]}>
                {d.getDate()}
              </Text>
              {hasEvents && <View style={[styles.eventDot, isSelected && styles.eventDotActive]} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Events */}
      <ScrollView style={styles.eventList} contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.selectedDateLabel}>
          {DAYS[selectedDate.getDay()]}, {selectedDate.getDate()} de {MONTHS[selectedDate.getMonth()]}
          {isSameDay(selectedDate, today) && '  · Hoy'}
        </Text>

        {loading ? (
          <ActivityIndicator color="#7C3AED" style={{ marginTop: 40 }} />
        ) : dayEvents.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>📭</Text>
            <Text style={styles.emptyTitle}>Sin eventos</Text>
            <Text style={styles.emptySub}>
              {hasIntegration
                ? 'No tienes nada agendado para este día.'
                : 'Conecta tu Google Calendar para ver tus eventos aquí.'}
            </Text>
            {!hasIntegration && (
              <TouchableOpacity
                style={styles.connectBtn}
                onPress={() => router.push('/settings/integrations')}
              >
                <Text style={styles.connectBtnText}>Conectar calendario →</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          dayEvents.map((event) => (
            <View key={event.id} style={styles.eventCard}>
              <View style={styles.eventTime}>
                <Text style={styles.eventTimeText}>{formatTime(event.starts_at)}</Text>
                {event.ends_at && (
                  <Text style={styles.eventTimeEnd}>{formatTime(event.ends_at)}</Text>
                )}
              </View>
              <View style={styles.eventBar} />
              <View style={styles.eventInfo}>
                <Text style={styles.eventTitle}>{event.title}</Text>
                {!!event.location && (
                  <Text style={styles.eventMeta}>📍 {event.location}</Text>
                )}
                {!!event.description && (
                  <Text style={styles.eventMeta} numberOfLines={2}>{event.description}</Text>
                )}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0B14' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 },
  monthYear: { fontSize: 13, color: '#71717A', fontWeight: '500' },
  pageTitle: { fontSize: 32, fontWeight: '800', color: '#FFFFFF' },
  syncBtn: { backgroundColor: '#17172A', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: '#3F3F46', minWidth: 80, alignItems: 'center' },
  syncBtnText: { color: '#A1A1AA', fontSize: 13, fontWeight: '600' },
  dayStrip: { paddingHorizontal: 16, gap: 8, paddingBottom: 16 },
  dayCell: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 10, borderRadius: 14, minWidth: 52, gap: 4 },
  dayCellActive: { backgroundColor: '#7C3AED' },
  dayName: { fontSize: 11, color: '#71717A', fontWeight: '600', textTransform: 'uppercase' },
  dayNameActive: { color: '#fff' },
  dayNum: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  dayNumActive: { color: '#FFFFFF' },
  dayNumToday: { color: '#7C3AED' },
  eventDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#7C3AED' },
  eventDotActive: { backgroundColor: '#fff' },
  eventList: { flex: 1, paddingHorizontal: 20 },
  selectedDateLabel: { fontSize: 14, color: '#A1A1AA', fontWeight: '600', marginBottom: 16 },
  emptyState: { alignItems: 'center', paddingTop: 40, gap: 8 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  emptySub: { fontSize: 14, color: '#71717A', textAlign: 'center', lineHeight: 20 },
  connectBtn: { marginTop: 12, backgroundColor: '#1E1735', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20, borderWidth: 1, borderColor: '#7C3AED' },
  connectBtnText: { color: '#7C3AED', fontWeight: '700', fontSize: 14 },
  eventCard: { flexDirection: 'row', gap: 12, marginBottom: 16, alignItems: 'flex-start' },
  eventTime: { width: 48, alignItems: 'flex-end', paddingTop: 2 },
  eventTimeText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  eventTimeEnd: { fontSize: 11, color: '#71717A' },
  eventBar: { width: 3, borderRadius: 2, backgroundColor: '#7C3AED', minHeight: 40, marginTop: 4 },
  eventInfo: { flex: 1, backgroundColor: '#17172A', borderRadius: 12, padding: 12, gap: 4 },
  eventTitle: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  eventMeta: { fontSize: 12, color: '#71717A' },
  disabled: { opacity: 0.5 },
});
