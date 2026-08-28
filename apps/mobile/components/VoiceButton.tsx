import { TouchableOpacity, View, Text, StyleSheet, Animated } from 'react-native';
import { Mic, MicOff } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { useVoiceStore } from '@/store/voice';
import { useSettingsStore } from '@/store/settings';
import * as Haptics from 'expo-haptics';

const VOICE_LABELS = {
  en: { speaking: 'Speaking...', processing: 'Processing...', wake: 'Listening...', recording: 'Recording...', idle: 'Hey Leeloo' },
  es: { speaking: 'Hablando...', processing: 'Procesando...', wake: 'Escuchando...', recording: 'Grabando...', idle: 'Hey Leeloo' },
  pt: { speaking: 'Falando...', processing: 'Processando...', wake: 'Ouvindo...', recording: 'Gravando...', idle: 'Hey Leeloo' },
  fr: { speaking: 'Parle...', processing: 'Traitement...', wake: 'Écoute...', recording: 'Enregistre...', idle: 'Hey Leeloo' },
} as const;

export function VoiceButton() {
  const { isListening, isProcessing, startListeningFromWakeWord, stopListening } = useVoiceStore();
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);
  const isWakeActivated = useVoiceStore((s) => s.isWakeActivated);
  const language = useSettingsStore((s) => s.language);
  const L = VOICE_LABELS[language] ?? VOICE_LABELS.en;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isListening) {
      // Pulse animation when listening
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isListening, pulseAnim]);

  const handlePress = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();

    if (isListening) await stopListening();
    else await startListeningFromWakeWord();
  };

  return (
    <View style={styles.container}>
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <TouchableOpacity
          onPress={handlePress}
          disabled={isProcessing}
          style={[
            styles.button,
            isListening && styles.buttonActive,
            isProcessing && styles.buttonProcessing,
          ]}
          activeOpacity={0.8}
        >
          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            {isListening ? <MicOff size={40} color="#fff" /> : <Mic size={40} color="#fff" />}
          </Animated.View>
        </TouchableOpacity>
      </Animated.View>

      <Text style={styles.label}>
        {isSpeaking
          ? L.speaking
          : isProcessing
            ? L.processing
            : isWakeActivated
              ? L.wake
              : isListening
                ? L.recording
                : L.idle}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginVertical: 30,
  },
  button: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  buttonActive: {
    backgroundColor: '#7C3AED',
  },
  buttonProcessing: {
    opacity: 0.6,
  },
  label: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '500',
    color: '#6B7280',
  },
});
