import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Animated,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { Audio } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { WaveBackground } from '@/components/WaveBackground';
import { T } from '@/lib/theme';
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
  const { userId } = useAuth();
  const setHasCompletedOnboarding = useAuthStore((s) => s.setHasCompletedOnboarding);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const [step, setStep] = useState<Step>(0);
  const [selectedLang, setSelectedLang] = useState('es');
  const [loading, setLoading] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const animateToStep = (next: Step) => {
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: -30, duration: 130, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
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
    await Notifications.requestPermissionsAsync();
    animateToStep(3);
  };

  const finishOnboarding = async () => {
    setLoading(true);
    try {
      await setLanguage(selectedLang as any);
      await profilesAPI.updateMe({ preferred_language: selectedLang as any }).catch(() => {});
      await setHasCompletedOnboarding(true, userId ?? undefined);
      router.replace('/(tabs)/home');
    } catch {
      await setHasCompletedOnboarding(true, userId ?? undefined);
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
    <View style={{ flex: 1, backgroundColor: T.colors.cream }}>
      <LinearGradient
        colors={['#FFF9F6', '#F0EDFF', '#E8E0FF']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <WaveBackground opacity={0.07} cellSize={38} />

      <SafeAreaView style={{ flex: 1, paddingHorizontal: 24 }}>
        {/* Progress dots */}
        <View style={s.dots}>
          {STEPS.map((_, i) => (
            <View
              key={i}
              style={[s.dot, i === step && s.dotActive]}
            />
          ))}
        </View>

        <Animated.View style={[s.content, { transform: [{ translateY: slideAnim }] }]}>
          {/* Icon card */}
          <LinearGradient
            colors={['#F07040', '#C4507A', '#8375FA']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.emojiCard}
          >
            <WaveBackground opacity={0.12} cellSize={28} />
            <Text style={s.emoji}>{currentStep.emoji}</Text>
          </LinearGradient>

          <Text style={s.title}>{currentStep.title}</Text>
          <Text style={s.subtitle}>{currentStep.subtitle}</Text>
          <Text style={s.description}>{currentStep.description}</Text>

          {/* Language selector */}
          {isLanguageStep && (
            <View style={s.langGrid}>
              {LANGUAGES.map((lang) => (
                <TouchableOpacity
                  key={lang.code}
                  style={[s.langCard, selectedLang === lang.code && s.langCardActive]}
                  onPress={() => setSelectedLang(lang.code)}
                  activeOpacity={0.75}
                >
                  <Text style={s.langFlag}>{lang.flag}</Text>
                  <Text style={[s.langLabel, selectedLang === lang.code && s.langLabelActive]}>
                    {lang.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </Animated.View>

        {/* Footer */}
        <View style={s.footer}>
          {isLanguageStep ? (
            <TouchableOpacity
              style={[s.primaryBtnWrap, loading && s.disabled]}
              onPress={finishOnboarding}
              disabled={loading}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#F07040', '#C4507A', '#8375FA']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={s.primaryBtnGradient}
              >
                <Text style={s.primaryBtnText}>
                  {loading ? 'Configurando...' : '¡Empezar con Leeloo! 🚀'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={s.primaryBtnWrap}
                onPress={handleAction}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={['#F07040', '#C4507A', '#8375FA']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={s.primaryBtnGradient}
                >
                  <Text style={s.primaryBtnText}>{currentStep.actionLabel}</Text>
                </LinearGradient>
              </TouchableOpacity>

              {step > 0 && (
                <TouchableOpacity
                  style={s.skipBtn}
                  onPress={() => animateToStep((step + 1) as Step)}
                >
                  <Text style={s.skipText}>Saltar por ahora</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 20,
    paddingBottom: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#D8D4EE',
  },
  dotActive: {
    backgroundColor: T.colors.purple,
    width: 28,
    borderRadius: 4,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 16,
    gap: 16,
  },
  emojiCard: {
    width: 100,
    height: 100,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    overflow: 'hidden',
    shadowColor: T.colors.orange,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 10,
  },
  emoji: { fontSize: 48 },
  title: {
    fontSize: 28,
    fontWeight: '800',
    fontFamily: T.fonts.bold,
    color: T.colors.navy,
    textAlign: 'center',
    lineHeight: 34,
  },
  subtitle: {
    fontSize: 16,
    color: '#4B4890',
    fontFamily: T.fonts.semiBold,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 22,
  },
  description: {
    fontSize: 14,
    color: T.colors.muted,
    fontFamily: T.fonts.regular,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 300,
  },
  langGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
    width: '100%',
  },
  langCard: {
    width: (SCREEN_WIDTH - 48 - 12) / 2,
    backgroundColor: T.colors.white,
    borderRadius: T.radius.lg,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: T.colors.border,
    shadowColor: T.colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  langCardActive: {
    borderColor: T.colors.purple,
    backgroundColor: '#F0EDFF',
  },
  langFlag: { fontSize: 36 },
  langLabel: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: T.fonts.semiBold,
    color: T.colors.muted,
  },
  langLabelActive: { color: T.colors.navy },
  footer: {
    paddingBottom: 20,
    gap: 10,
  },
  primaryBtnWrap: {
    borderRadius: T.radius.md,
    overflow: 'hidden',
    shadowColor: T.colors.orange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  primaryBtnGradient: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: T.colors.white,
    fontSize: 17,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
  },
  skipBtn: { alignItems: 'center', paddingVertical: 10 },
  skipText: {
    color: '#9CA3AF',
    fontSize: 15,
    fontFamily: T.fonts.regular,
  },
  disabled: { opacity: 0.6 },
});
