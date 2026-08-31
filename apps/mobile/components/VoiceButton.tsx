import { TouchableOpacity, View, Text, StyleSheet, Animated } from 'react-native';
import { Mic, MicOff } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { useVoiceStore } from '@/store/voice';
import { useSettingsStore } from '@/store/settings';
import * as Haptics from 'expo-haptics';

const VOICE_LABELS = {
  en: { speaking: 'Speaking...', processing: 'Processing...', wake: 'Listening...', recording: 'Recording...', idle: 'Hey Leeloo', always: 'Always listening' },
  es: { speaking: 'Hablando...', processing: 'Procesando...', wake: 'Escuchando...', recording: 'Grabando...', idle: 'Hey Leeloo', always: 'Siempre escuchando' },
  pt: { speaking: 'Falando...', processing: 'Processando...', wake: 'Ouvindo...', recording: 'Gravando...', idle: 'Hey Leeloo', always: 'Sempre ouvindo' },
  fr: { speaking: 'Parle...', processing: 'Traitement...', wake: 'Écoute...', recording: 'Enregistre...', idle: 'Hey Leeloo', always: 'Toujours à l\'écoute' },
} as const;

type Props = {
  alwaysListening?: boolean;
};

export function VoiceButton({ alwaysListening = false }: Props) {
  const { isListening, isProcessing, startListeningFromWakeWord, stopListening } = useVoiceStore();
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);
  const isWakeActivated = useVoiceStore((s) => s.isWakeActivated);
  const language = useSettingsStore((s) => s.language);
  const L = VOICE_LABELS[language] ?? VOICE_LABELS.en;

  const scaleAnim   = useRef(new Animated.Value(1)).current;
  const pulseAnim   = useRef(new Animated.Value(1)).current;
  const ringAnim    = useRef(new Animated.Value(0.6)).current;   // always-listening ring
  const ringOpacity = useRef(new Animated.Value(0.35)).current;

  // Active pulse when recording / speaking
  useEffect(() => {
    if (isListening || isSpeaking) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.12, duration: 750, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,    duration: 750, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [isListening, isSpeaking, pulseAnim]);

  // Slow breathe ring — shows when always-listening is active and Leeloo is idle
  useEffect(() => {
    const idle = alwaysListening && !isListening && !isProcessing && !isSpeaking;
    if (idle) {
      Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ringAnim,    { toValue: 1.4,  duration: 2000, useNativeDriver: true }),
            Animated.timing(ringOpacity, { toValue: 0,    duration: 2000, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ringAnim,    { toValue: 0.6,  duration: 0,    useNativeDriver: true }),
            Animated.timing(ringOpacity, { toValue: 0.35, duration: 0,    useNativeDriver: true }),
          ]),
        ]),
      ).start();
    } else {
      ringAnim.stopAnimation();
      ringOpacity.stopAnimation();
      ringAnim.setValue(0.6);
      ringOpacity.setValue(0);
    }
  }, [alwaysListening, isListening, isProcessing, isSpeaking, ringAnim, ringOpacity]);

  const handlePress = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.92, duration: 80, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1,    duration: 80, useNativeDriver: true }),
    ]).start();

    if (isListening) await stopListening();
    else await startListeningFromWakeWord();
  };

  const label = isSpeaking
    ? L.speaking
    : isProcessing
      ? L.processing
      : isWakeActivated
        ? L.wake
        : isListening
          ? L.recording
          : alwaysListening
            ? L.always
            : L.idle;

  return (
    <View style={styles.container}>
      {/* Always-listening breathe ring — renders behind the button */}
      {alwaysListening && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              transform: [{ scale: ringAnim }],
              opacity: ringOpacity,
            },
          ]}
        />
      )}

      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <TouchableOpacity
          onPress={handlePress}
          disabled={isProcessing}
          style={[
            styles.button,
            isListening   && styles.buttonActive,
            isProcessing  && styles.buttonProcessing,
            alwaysListening && !isListening && !isProcessing && !isSpeaking && styles.buttonIdle,
          ]}
          activeOpacity={0.8}
        >
          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            {isListening
              ? <MicOff size={40} color="#fff" />
              : <Mic    size={40} color="#fff" />}
          </Animated.View>
        </TouchableOpacity>
      </Animated.View>

      <Text style={[styles.label, alwaysListening && !isListening && !isProcessing && styles.labelActive]}>
        {label}
      </Text>

      {/* Tiny dot — always-listening indicator */}
      {alwaysListening && (
        <View style={styles.earDot}>
          <View style={[
            styles.earDotInner,
            (isListening || isSpeaking || isProcessing) && styles.earDotBusy,
          ]} />
        </View>
      )}
    </View>
  );
}

const PURPLE = '#8B5CF6';
const PURPLE_DARK = '#7C3AED';

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginVertical: 30,
  },
  ring: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: PURPLE,
    top: 0,
  },
  button: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: PURPLE,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: PURPLE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 10,
  },
  buttonActive: {
    backgroundColor: PURPLE_DARK,
  },
  buttonProcessing: {
    opacity: 0.6,
  },
  buttonIdle: {
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  label: {
    marginTop: 16,
    fontSize: 15,
    fontWeight: '500',
    color: '#6B7280',
    letterSpacing: 0.2,
  },
  labelActive: {
    color: PURPLE,
    fontWeight: '600',
  },
  earDot: {
    marginTop: 8,
    alignItems: 'center',
  },
  earDotInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: PURPLE,
    opacity: 0.6,
  },
  earDotBusy: {
    backgroundColor: '#F59E0B',
    opacity: 1,
  },
});
