import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
  Animated,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { Audio } from 'expo-av';
import * as Contacts from 'expo-contacts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '@/store/auth';
import { profilesAPI } from '@/lib/api';
import { useSettingsStore } from '@/store/settings';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Step = 0 | 1 | 2 | 3;

const STEPS = [
  {
    emoji: '👋',
    title: 'Bienvenida a Leeloo',
    subtitle: 'Tu asistente personal inteligente para mujeres que lo hacen todo.',
    description: 'Leeloo te ayuda con tu agenda, tus hijos, tu hogar, tu trabajo y tu bienestar — todo por voz.',
    action: null,
    actionLabel: 'Comenzar',
  },
  {
    emoji: '🎤',
    title: 'Leeloo necesita escucharte',
    subtitle: 'Para funcionar por voz necesitamos acceso al micrófono.',
    description: 'Tus grabaciones nunca se almacenan permanentemente. Solo se procesan para entenderte y responderte.',
    action: 'microphone',
    actionLabel: 'Permitir micrófono',
  },
  {
    emoji: '🔔',
    title: 'Alertas y recordatorios',
    subtitle: 'Leeloo te avisará de tus compromisos, reuniones y tareas importantes.',
    description: 'Recibirás tu briefing matutino a las 7am y alertas antes de cada cita.',
    action: 'notifications',
    actionLabel: 'Activar notificaciones',
  },
  {
    emoji: '🌍',
    title: '¿En qué idioma prefieres?',
    subtitle: 'Leeloo se adaptará a tu idioma.',
    description: 'Puedes cambiarlo después en Configuración.',
    action: 'language',
    actionLabel: null,
  },
];

const LANGUAGES = [
  { code: 'es', label: 'Español', flag: '🇨🇴' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'pt', label: 'Português', flag: '🇧🇷' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const setHasCompletedOnboarding = useAuthStore((s) => s.setHasCompletedOnboarding);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const [step, setStep] = useState<Step>(0);
  const [selectedLang, setSelectedLang] = useState('es');
  const [loading, setLoading] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const animateToStep = (next: Step) => {
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: -40, duration: 150, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
    setStep(next);
  };

  const requestMicrophone = async () => {
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Micrófono necesario',
        'Sin el micrófono Leeloo no puede escucharte. Puedes activarlo en Ajustes del teléfono.',
        [{ text: 'Entendido' }],
      );
    }
    animateToStep(2);
  };

  const requestNotifications = async () => {
    const { status } = await Notifications.requestPermissionsAsync();
    animateToStep(3);
  };

  const finishOnboarding = async () => {
    setLoading(true);
    try {
      await setLanguage(selectedLang as any);
      // Register device locale with backend
      const locale = selectedLang === 'es' ? 'es-CO' : selectedLang === 'en' ? 'en-US' : selectedLang === 'pt' ? 'pt-BR' : 'fr-FR';
      await profilesAPI.updateMe({ preferred_language: selectedLang as any }).catch(() => {});
      await setHasCompletedOnboarding(true);
      router.replace('/(tabs)/home');
    } catch {
      await setHasCompletedOnboarding(true);
      router.replace('/(tabs)/home');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async () => {
    const current = STEPS[step];
    if (current.action === 'microphone') {
      await requestMicrophone();
    } else if (current.action === 'notifications') {
      await requestNotifications();
    } else if (step === 0) {
      animateToStep(1);
    }
  };

  const currentStep = STEPS[step];
  const isLanguageStep = step === 3;

  return (
    <SafeAreaView style={styles.container}>
      {/* Progress dots */}
      <View style={styles.dots}>
        {STEPS.map((_, i) => (
          <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
        ))}
      </View>

      <Animated.View style={[styles.content, { transform: [{ translateY: slideAnim }] }]}>
        <Text style={styles.emoji}>{currentStep.emoji}</Text>
        <Text style={styles.title}>{currentStep.title}</Text>
        <Text style={styles.subtitle}>{currentStep.subtitle}</Text>
        <Text style={styles.description}>{currentStep.description}</Text>

        {isLanguageStep && (
          <View style={styles.langGrid}>
            {LANGUAGES.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={[styles.langCard, selectedLang === lang.code && styles.langCardActive]}
                onPress={() => setSelectedLang(lang.code)}
              >
                <Text style={styles.langFlag}>{lang.flag}</Text>
                <Text style={[styles.langLabel, selectedLang === lang.code && styles.langLabelActive]}>
                  {lang.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </Animated.View>

      <View style={styles.footer}>
        {isLanguageStep ? (
          <TouchableOpacity
            style={[styles.primaryBtn, loading && styles.disabled]}
            onPress={finishOnboarding}
            disabled={loading}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>
              {loading ? 'Configurando...' : '¡Empezar con Leeloo! 🚀'}
            </Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleAction}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>{currentStep.actionLabel}</Text>
            </TouchableOpacity>

            {step > 0 && (
              <TouchableOpacity
                style={styles.skipBtn}
                onPress={() => animateToStep((step + 1) as Step)}
              >
                <Text style={styles.skipText}>Saltar por ahora</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0B14',
    paddingHorizontal: 28,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 20,
    paddingBottom: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3F3F46',
  },
  dotActive: {
    backgroundColor: '#7C3AED',
    width: 24,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 20,
  },
  emoji: {
    fontSize: 72,
    textAlign: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 36,
  },
  subtitle: {
    fontSize: 16,
    color: '#A1A1AA',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 22,
  },
  description: {
    fontSize: 14,
    color: '#71717A',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  langGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
    marginTop: 8,
  },
  langCard: {
    width: (SCREEN_WIDTH - 56 - 12) / 2,
    backgroundColor: '#17172A',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  langCardActive: {
    borderColor: '#7C3AED',
    backgroundColor: '#1E1735',
  },
  langFlag: {
    fontSize: 36,
  },
  langLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#A1A1AA',
  },
  langLabelActive: {
    color: '#FFFFFF',
  },
  footer: {
    paddingBottom: 24,
    gap: 12,
  },
  primaryBtn: {
    backgroundColor: '#7C3AED',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  skipBtn: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  skipText: {
    color: '#71717A',
    fontSize: 15,
  },
  disabled: { opacity: 0.6 },
});
