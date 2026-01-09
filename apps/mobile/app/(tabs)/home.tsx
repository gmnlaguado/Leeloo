import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Mic, MicOff } from 'lucide-react-native';
import { useState } from 'react';
import { useVoiceStore } from '@/store/voice';
import { VoiceButton } from '@/components/VoiceButton';
import { TaskList } from '@/components/TaskList';
import { MotivationalCard } from '@/components/MotivationalCard';

export default function HomeScreen() {
  const { transcription, response, isProcessing, lastError, sendText } = useVoiceStore();
  const [draft, setDraft] = useState('');

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
          <Text style={styles.greeting}>Hola! 👋</Text>
          <Text style={styles.subtitle}>¿Cómo puedo ayudarte hoy?</Text>
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
              style={[styles.sendButton, (isProcessing || !draft.trim()) && styles.sendButtonDisabled]}
            >
              <Text style={styles.sendButtonText}>{isProcessing ? '...' : 'Send'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Motivational Card */}
        <MotivationalCard />

        {/* Today's Tasks */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Today's Tasks</Text>
          <TaskList limit={5} />
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
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionCard: {
    width: '48%',
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
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
