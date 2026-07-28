import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useMemo, useState } from 'react';
import { useVoiceStore } from '@/store/voice';
import { VoiceButton } from '@/components/VoiceButton';
import { MotivationalCard } from '@/components/MotivationalCard';
import { useAuthStore } from '@/store/auth';
import { useTasksStore } from '@/store/tasks';
import { ChildRequestBanner } from '@/components/ChildRequestBanner';
import { LeelooAvatar } from '@/components/LeelooAvatar';
import { useRouter } from 'expo-router';

export default function HomeScreen() {
  const { transcription, response, isProcessing, lastError, sendText } = useVoiceStore();
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);
  const session = useAuthStore((s) => s.session);
  const hydrateTasks = useTasksStore((s) => s.hydrate);
  const tasks = useTasksStore((s) => s.tasks);
  const router = useRouter();
  const [draft, setDraft] = useState('');

  useEffect(() => {
    hydrateTasks();
  }, [hydrateTasks]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Buenos días';
    if (hour < 18) return 'Buenas tardes';
    return 'Buenas noches';
  }, []);

  const userMetadata = ((session as any)?.user?.user_metadata || undefined) as
    | Record<string, unknown>
    | undefined;

  const name =
    (typeof userMetadata?.full_name === 'string' && userMetadata.full_name.trim()
      ? userMetadata.full_name
      : undefined) ||
    (typeof userMetadata?.name === 'string' && userMetadata.name.trim() ? userMetadata.name : '') ||
    'mamá';

  const upcoming = useMemo(() => {
    const pending = (tasks || []).filter((t) => String(t.status || '') !== 'done');
    const sorted = pending.sort((a, b) => {
      const aMs = a.due_at ? new Date(a.due_at).getTime() : Infinity;
      const bMs = b.due_at ? new Date(b.due_at).getTime() : Infinity;
      return aMs - bMs;
    });
    return sorted.slice(0, 3);
  }, [tasks]);

  const pendingApprovalsCount = useMemo(() => {
    return (tasks || []).filter((t) => String(t.status || '') === 'pending_approval').length;
  }, [tasks]);

  const handleSend = async () => {
    const text = draft;
    setDraft('');
    await sendText(text);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.greeting}>
                {greeting}, {name}
              </Text>
              <Text style={styles.subtitle}>¿Cómo puedo ayudarte hoy?</Text>
            </View>
            <LeelooAvatar active={isSpeaking} />
          </View>

          <ChildRequestBanner
            count={pendingApprovalsCount}
            onPress={() => router.push('/(tabs)/dashboard?tab=approvals')}
          />
        </View>

        {/* Voice Button */}
        <VoiceButton />

        <View style={styles.chatCard}>
          <Text style={styles.chatTitle}>Chat</Text>

          {!!lastError && <Text style={styles.errorText}>{lastError}</Text>}

          {!!transcription && (
            <View style={styles.bubbleUser}>
              <Text style={styles.bubbleUserText}>{transcription}</Text>
            </View>
          )}

          {!!response && (
            <View style={styles.bubbleBot}>
              <Text style={styles.bubbleBotText}>{response}</Text>
            </View>
          )}

          <View style={styles.chatInputRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Escribe tu mensaje..."
              placeholderTextColor="#9CA3AF"
              editable={!isProcessing}
              style={styles.chatInput}
              returnKeyType="send"
              onSubmitEditing={handleSend}
            />
            <TouchableOpacity
              onPress={handleSend}
              disabled={isProcessing || !draft.trim()}
              style={[
                styles.sendButton,
                (isProcessing || !draft.trim()) && styles.sendButtonDisabled,
              ]}
            >
              <Text style={styles.sendButtonText}>{isProcessing ? '...' : 'Send'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Motivational Card */}
        <MotivationalCard />

        {/* Today's Tasks */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Próximas tareas</Text>
          {upcoming.length === 0 ? (
            <Text style={styles.emptyText}>No hay tareas pendientes.</Text>
          ) : (
            <View style={{ gap: 8 }}>
              {upcoming.map((t) => (
                <View key={t.id} style={styles.taskRow}>
                  <Text style={styles.taskTitle}>{t.title}</Text>
                  {!!t.due_at && (
                    <Text style={styles.taskMeta}>{new Date(t.due_at).toLocaleDateString()}</Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.quickActions}>
            <TouchableOpacity style={styles.actionCard}>
              <Text style={styles.actionEmoji}>📧</Text>
              <Text style={styles.actionText}>Check Email</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionCard}>
              <Text style={styles.actionEmoji}>🛒</Text>
              <Text style={styles.actionText}>Shopping List</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionCard}>
              <Text style={styles.actionEmoji}>📅</Text>
              <Text style={styles.actionText}>Schedule</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionCard}>
              <Text style={styles.actionEmoji}>👨‍👩‍👧</Text>
              <Text style={styles.actionText}>Family</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
  },
  header: {
    marginTop: 20,
    marginBottom: 30,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  greeting: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 4,
  },
  section: {
    marginTop: 30,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 16,
  },
  emptyText: {
    color: '#6B7280',
  },
  taskRow: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  taskMeta: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  actionCard: {
    flex: 1,
    backgroundColor: '#f5f0ff',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    gap: 6,
  },
  actionEmoji: {
    fontSize: 32,
    marginBottom: 8,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },
  chatCard: {
    marginTop: 10,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  chatTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  errorText: {
    color: '#B91C1C',
    marginBottom: 12,
    fontSize: 13,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#8B5CF6',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
    maxWidth: '90%',
  },
  bubbleUserText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
  },
  bubbleBot: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    maxWidth: '90%',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  bubbleBotText: {
    color: '#111827',
    fontSize: 14,
    lineHeight: 20,
  },
  chatInputRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  chatInput: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    color: '#111827',
  },
  sendButton: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#8B5CF6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
});
