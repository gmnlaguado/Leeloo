import { TouchableOpacity, View, Text, StyleSheet, Animated, Linking, Alert } from 'react-native';
import { Mic, MicOff, MicOff as MicBlocked, Square } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { useVoiceStore } from '@/store/voice';
import { useSettingsStore } from '@/store/settings';
import * as Haptics from 'expo-haptics';
import * as IntentLauncher from 'expo-intent-launcher';

const VOICE_LABELS = {
  en: { speaking: 'Tap to interrupt', processing: 'Tap to interrupt', wake: 'Listening...', recording: 'I\'m listening...', idle: 'Tap to speak', hint: 'or say "Hey Leeloo"', mic_denied: 'Microphone blocked', mic_denied_btn: 'Open Settings', mic_denied_detail: 'Leeloo needs microphone access to hear you.' },
  es: { speaking: 'Toca para interrumpir', processing: 'Toca para interrumpir', wake: 'Escuchando...', recording: 'Te escucho...', idle: 'Toca para hablar', hint: 'o di "Hey Leeloo"', mic_denied: 'Micrófono bloqueado', mic_denied_btn: 'Abrir Configuración', mic_denied_detail: 'Leeloo necesita acceso al micrófono para escucharte.' },
  pt: { speaking: 'Toque para interromper', processing: 'Toque para interromper', wake: 'Ouvindo...', recording: 'Estou ouvindo...', idle: 'Toque para falar', hint: 'ou diga "Hey Leeloo"', mic_denied: 'Microfone bloqueado', mic_denied_btn: 'Abrir Configurações', mic_denied_detail: 'Leeloo precisa de acesso ao microfone para te ouvir.' },
  fr: { speaking: 'Toucher pour interrompre', processing: 'Toucher pour interrompre', wake: 'J\'écoute...', recording: 'Je t\'écoute...', idle: 'Toucher pour parler', hint: 'ou dis "Hey Leeloo"', mic_denied: 'Micro bloqué', mic_denied_btn: 'Ouvrir les réglages', mic_denied_detail: 'Leeloo a besoin d\'accéder au micro pour vous entendre.' },
} as const;

type Props = {
  alwaysListening?: boolean;
  showHint?: boolean;
};

export function VoiceButton({ alwaysListening = false, showHint = true }: Props) {
  const { isListening, isProcessing, startListeningFromWakeWord, stopListening, interruptSpeaking, lastError } = useVoiceStore();
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);
  const isWakeActivated = useVoiceStore((s) => s.isWakeActivated);
  const language = useSettingsStore((s) => s.language);
  const L = VOICE_LABELS[language] ?? VOICE_LABELS.en;
  const micPermDenied = lastError === 'MIC_PERMISSION_DENIED';

  const openSettings = () => {
    Linking.openSettings().catch(() => {
      Alert.alert(L.mic_denied, L.mic_denied_detail);
    });
  };

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

    if (isSpeaking || isProcessing) {
      // Interrupt Leeloo mid-response and start listening immediately
      await interruptSpeaking();
    } else if (isListening) {
      await stopListening();
    } else {
      await startListeningFromWakeWord();
    }
  };

  const label = isSpeaking
    ? L.speaking
    : isProcessing
      ? L.processing
      : (isWakeActivated || isListening)
        ? L.recording
        : L.idle;

  // Show hint only in truly idle state (not recording/processing/speaking)
  const isActive = isListening || isProcessing || isSpeaking || isWakeActivated;
  const showWakeHint = showHint && alwaysListening && !isActive;

  // Permission denied state — show clear CTA instead of broken button
  if (micPermDenied) {
    return (
      <View style={styles.container}>
        <View style={styles.deniedCard}>
          <MicBlocked size={32} color="#DC2626" />
          <Text style={styles.deniedTitle}>{L.mic_denied}</Text>
          <Text style={styles.deniedDetail}>{L.mic_denied_detail}</Text>
          <TouchableOpacity style={styles.deniedBtn} onPress={openSettings} activeOpacity={0.8}>
            <Text style={styles.deniedBtnText}>{L.mic_denied_btn} →</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

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
          style={[
            styles.button,
            isListening   && styles.buttonActive,
            isProcessing  && styles.buttonProcessing,
            isSpeaking    && styles.buttonSpeaking,
            alwaysListening && !isListening && !isProcessing && !isSpeaking && styles.buttonIdle,
          ]}
          activeOpacity={0.8}
        >
          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            {isListening
              ? <MicOff  size={40} color="#fff" />
              : (isSpeaking || isProcessing)
              ? <Square  size={36} color="#fff" />
              : <Mic     size={40} color="#fff" />}
          </Animated.View>
        </TouchableOpacity>
      </Animated.View>

      <Text style={[styles.label, isActive && styles.labelActive]}>
        {label}
      </Text>

      {/* "or say Hey Leeloo" hint — only visible in passive idle */}
      {showWakeHint && (
        <Text style={styles.hintText}>{L.hint}</Text>
      )}

      {/* Tiny dot — wake word active indicator */}
      {alwaysListening && (
        <View style={styles.earDot}>
          <View style={[
            styles.earDotInner,
            isActive && styles.earDotBusy,
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
    opacity: 0.7,
  },
  buttonSpeaking: {
    backgroundColor: '#2D266C',
    shadowColor: '#2D266C',
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
  hintText: {
    marginTop: 4,
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '400',
    letterSpacing: 0.1,
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
  deniedCard: {
    alignItems: 'center',
    backgroundColor: '#FFF5F5',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#FECACA',
    paddingVertical: 20,
    paddingHorizontal: 24,
    gap: 8,
    marginVertical: 8,
  },
  deniedTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#DC2626',
    marginTop: 4,
  },
  deniedDetail: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 18,
  },
  deniedBtn: {
    marginTop: 8,
    backgroundColor: '#8375FA',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  deniedBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
});
