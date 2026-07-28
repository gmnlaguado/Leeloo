import { Modal, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useEffect } from 'react';
import { useVoiceStore } from '@/store/voice';

export function VoiceConfirmationModal() {
  const awaitingConfirmation = useVoiceStore((s) => s.awaitingConfirmation);
  const pendingText = useVoiceStore((s) => s.pendingConfirmationText);
  const isProcessing = useVoiceStore((s) => s.isProcessing);
  const confirm = useVoiceStore((s) => s.confirm);
  const cancel = useVoiceStore((s) => s.cancel);

  useEffect(() => {
    // The voice store already plays TTS when the awaiting_confirmation response arrives.
    // This modal only provides explicit user confirmation.
  }, [awaitingConfirmation]);

  return (
    <Modal visible={awaitingConfirmation} transparent animationType="slide">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Confirmar</Text>
          <Text style={styles.subtitle}>Leeloo quiere confirmar antes de ejecutar:</Text>

          <View style={styles.preview}>
            <Text style={styles.previewText}>{pendingText}</Text>
          </View>

          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={cancel}
              disabled={isProcessing}
            >
              <Text style={styles.cancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.confirmButton]}
              onPress={confirm}
              disabled={isProcessing}
            >
              <Text style={styles.confirmText}>{isProcessing ? '...' : 'Confirmar'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#fff',
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    color: '#6B7280',
  },
  preview: {
    marginTop: 14,
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  previewText: {
    fontSize: 14,
    color: '#111827',
    lineHeight: 20,
  },
  row: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  confirmButton: {
    backgroundColor: '#8B5CF6',
  },
  cancelText: {
    color: '#B91C1C',
    fontWeight: '800',
  },
  confirmText: {
    color: '#fff',
    fontWeight: '800',
  },
});
