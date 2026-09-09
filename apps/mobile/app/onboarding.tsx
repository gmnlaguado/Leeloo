import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  Animated,
  Dimensions,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { WaveBackground } from '@/components/WaveBackground';
import { T } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';
import { profilesAPI } from '@/lib/api';
import { useSettingsStore } from '@/store/settings';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Steps: 0=welcome, 1=name, 2=personality, 3=microphone, 4=notifications, 5=language, 6=tour
type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6;
const TOTAL_STEPS = 7;

// Voice lines Leeloo says at each step (expo-speech — works offline, no API cost)
const VOICE_LINES: Record<number, Record<string, string>> = {
  0: {
    es: '¡Hola! Soy Leeloo, tu asistente personal inteligente. Estoy aquí para ayudarte con todo: tu agenda, tus tareas, tus recordatorios y mucho más — todo por voz. ¡Empecemos!',
    en: "Hi! I'm Leeloo, your personal intelligent assistant. I'm here to help you with everything — your schedule, tasks, reminders, and more — all by voice. Let's get started!",
    pt: 'Olá! Sou Leeloo, sua assistente pessoal inteligente. Estou aqui para te ajudar com tudo: agenda, tarefas, lembretes e muito mais — tudo por voz. Vamos começar!',
    fr: 'Bonjour ! Je suis Leeloo, votre assistante personnelle intelligente. Je suis là pour vous aider avec tout : agenda, tâches, rappels et plus encore — tout par la voix. Commençons !',
  },
  1: {
    es: '¿Cómo te llamas? Escribe tu nombre o el apodo con el que quieres que te llame. Así podremos tener una conversación más personal.',
    en: "What's your name? Type your name or the nickname you'd like me to use. That way our conversations will feel more personal.",
    pt: 'Qual é o seu nome? Digite seu nome ou apelido que prefere que eu use. Assim nossas conversas serão mais pessoais.',
    fr: 'Comment vous appelez-vous ? Tapez votre prénom ou le surnom que vous souhaitez que j\'utilise. Nos conversations seront ainsi plus personnelles.',
  },
  2: {
    es: 'Ahora elige cómo quieres que sea tu Leeloo. Cada personalidad tiene un estilo diferente — y puedes cambiarla en cualquier momento diciendo: "Leeloo, cambia tu personalidad a coach". Yo me adapto a ti.',
    en: "Now choose how you want your Leeloo to be. Each personality has a different style — and you can change it anytime by saying: 'Leeloo, change your personality to coach'. I adapt to you.",
    pt: 'Agora escolha como quer que seja sua Leeloo. Cada personalidade tem um estilo diferente — e você pode mudá-la a qualquer momento dizendo: "Leeloo, mude sua personalidade para coach". Eu me adapto a você.',
    fr: 'Maintenant, choisissez comment vous voulez que soit votre Leeloo. Chaque personnalité a un style différent — et vous pouvez la changer à tout moment en disant : "Leeloo, change ta personnalité en coach". Je m\'adapte à vous.',
  },
  3: {
    es: 'Para escucharte y responderte necesito acceso a tu micrófono. Sin él no puedo activarme cuando me llames. Tus grabaciones nunca se guardan — solo se procesan para entenderte.',
    en: "To listen and respond to you I need access to your microphone. Without it I can't activate when you call me. Your recordings are never stored — they're only processed to understand you.",
    pt: 'Para ouvir e responder você, preciso de acesso ao microfone. Sem ele não posso me ativar quando você me chamar. Suas gravações nunca são armazenadas — são apenas processadas para entender você.',
    fr: "Pour vous écouter et vous répondre, j'ai besoin d'accéder à votre microphone. Sans lui je ne peux pas m'activer quand vous m'appelez. Vos enregistrements ne sont jamais stockés.",
  },
  4: {
    es: 'También quiero avisarte de tus compromisos, reuniones y tareas importantes. Recibirás alertas antes de cada cita y podrás configurar recordatorios por voz.',
    en: "I also want to alert you about your commitments, meetings, and important tasks. You'll receive alerts before each appointment and can set reminders by voice.",
    pt: 'Também quero te avisar sobre seus compromissos, reuniões e tarefas importantes. Você receberá alertas antes de cada compromisso e poderá configurar lembretes por voz.',
    fr: "Je souhaite aussi vous alerter sur vos engagements, réunions et tâches importantes. Vous recevrez des alertes avant chaque rendez-vous et pourrez configurer des rappels par la voix.",
  },
  5: {
    es: '¿En qué idioma prefieres que te hable? Puedes cambiarlo después en Configuración.',
    en: 'Which language do you prefer? You can change it later in Settings.',
    pt: 'Qual idioma você prefere? Pode mudar depois nas Configurações.',
    fr: 'Quelle langue préférez-vous ? Vous pourrez la changer plus tard dans les Paramètres.',
  },
  6: {
    es: '¡Todo listo! Puedo ayudarte con tu agenda, crear tareas, enviarte recordatorios, buscar información, enviar correos y mucho más. Solo di "Leeloo" en cualquier momento para activarme — incluso con el teléfono en reposo. ¡Estoy lista cuando tú quieras!',
    en: "All set! I can help you with your schedule, create tasks, send reminders, search for information, send emails, and much more. Just say 'Leeloo' at any time to activate me — even when your phone is asleep. I'm ready whenever you are!",
    pt: 'Tudo pronto! Posso te ajudar com sua agenda, criar tarefas, enviar lembretes, buscar informações, enviar e-mails e muito mais. Só diga "Leeloo" a qualquer momento para me ativar — mesmo com o telefone em repouso. Estou pronta quando você quiser!',
    fr: "Tout est prêt ! Je peux vous aider avec votre agenda, créer des tâches, envoyer des rappels, chercher des informations, envoyer des e-mails et bien plus encore. Dites simplement \"Leeloo\" à tout moment pour m'activer — même en veille. Je suis prête quand vous voulez !",
  },
};

const PERSONALITIES = [
  { key: 'default',    emoji: '✨', label: { es: 'Equilibrada',   en: 'Balanced',    pt: 'Equilibrada',   fr: 'Équilibrée'   }, desc: { es: 'Tu amiga de todo: agenda, emociones y todo lo demás.', en: 'Your everything friend: schedule, emotions, and everything else.', pt: 'Sua amiga de tudo: agenda, emoções e tudo mais.', fr: 'Votre amie de tout : agenda, émotions et tout le reste.' } },
  { key: 'coach',      emoji: '🏆', label: { es: 'Coach',         en: 'Coach',       pt: 'Coach',         fr: 'Coach'        }, desc: { es: 'Te empuja con firmeza hacia tus metas.', en: 'Pushes you firmly toward your goals.', pt: 'Te impulsiona firmemente em direção às suas metas.', fr: 'Vous pousse fermement vers vos objectifs.' } },
  { key: 'mentor',     emoji: '🔭', label: { es: 'Mentora',       en: 'Mentor',      pt: 'Mentora',       fr: 'Mentor'       }, desc: { es: 'Te da perspectiva, no solo soluciones.', en: 'Gives you perspective, not just solutions.', pt: 'Te dá perspectiva, não apenas soluções.', fr: 'Vous donne de la perspective, pas seulement des solutions.' } },
  { key: 'business',   emoji: '💼', label: { es: 'Ejecutiva',     en: 'Executive',   pt: 'Executiva',     fr: 'Dirigeante'   }, desc: { es: 'Tu secretaria ejecutiva de clase Fortune 500.', en: 'Your Fortune 500-level executive assistant.', pt: 'Sua secretária executiva Fortune 500.', fr: 'Votre assistante exécutive niveau Fortune 500.' } },
  { key: 'counselor',  emoji: '💜', label: { es: 'Consejera',     en: 'Counselor',   pt: 'Conselheira',   fr: 'Conseillère'  }, desc: { es: 'Tu espacio seguro. Escucha sin juzgar.', en: 'Your safe space. Listens without judgment.', pt: 'Seu espaço seguro. Ouve sem julgamento.', fr: 'Votre espace sûr. Écoute sans jugement.' } },
  { key: 'christian',  emoji: '✝️', label: { es: 'Cristiana',     en: 'Christian',   pt: 'Cristã',        fr: 'Chrétienne'   }, desc: { es: 'Integra fe y vida cotidiana de forma natural.', en: 'Integrates faith and daily life naturally.', pt: 'Integra fé e vida cotidiana de forma natural.', fr: 'Intègre foi et vie quotidienne naturellement.' } },
  { key: 'nurturing',  emoji: '🌸', label: { es: 'Amorosa',       en: 'Nurturing',   pt: 'Amorosa',       fr: 'Bienveillante'}, desc: { es: 'Te cuida cuando tú cuidas a todos los demás.', en: "Takes care of you when you're busy caring for everyone else.", pt: 'Cuida de você quando você cuida de todos os outros.', fr: 'Prend soin de vous quand vous prenez soin de tout le monde.' } },
  { key: 'motivation', emoji: '🔥', label: { es: 'Motivadora',    en: 'Motivator',   pt: 'Motivadora',    fr: 'Motivatrice'  }, desc: { es: 'La voz que te recuerda quién eres cuando lo olvidas.', en: 'The voice that reminds you who you are when you forget.', pt: 'A voz que te lembra quem você é quando esquece.', fr: 'La voix qui vous rappelle qui vous êtes quand vous oubliez.' } },
];

const LANGUAGES = [
  { code: 'es', label: 'Español',    flag: '🇨🇴' },
  { code: 'en', label: 'English',    flag: '🇺🇸' },
  { code: 'pt', label: 'Português',  flag: '🇧🇷' },
  { code: 'fr', label: 'Français',   flag: '🇫🇷' },
];

const STEP_TITLES: Record<number, Record<string, string>> = {
  0: { es: 'Hola, soy Leeloo',      en: "Hi, I'm Leeloo",          pt: 'Olá, sou Leeloo',         fr: 'Bonjour, je suis Leeloo'   },
  1: { es: '¿Cómo te llamas?',      en: "What's your name?",       pt: 'Qual é o seu nome?',       fr: 'Comment vous appelez-vous ?' },
  2: { es: 'Tu personalidad',        en: 'Your personality',        pt: 'Sua personalidade',        fr: 'Votre personnalité'         },
  3: { es: 'Activa tu micrófono',   en: 'Activate your microphone', pt: 'Ative seu microfone',      fr: 'Activez votre microphone'   },
  4: { es: 'Alertas y recordatorios', en: 'Alerts & reminders',    pt: 'Alertas e lembretes',      fr: 'Alertes et rappels'         },
  5: { es: '¿En qué idioma?',       en: 'Which language?',         pt: 'Qual idioma?',             fr: 'Quelle langue ?'            },
  6: { es: '¡Todo listo!',          en: "All set!",                 pt: 'Tudo pronto!',             fr: 'Tout est prêt !'            },
};

const STEP_EMOJIS = ['👋', '😊', '✨', '🎤', '🔔', '🌍', '🚀'];

function speakLine(text: string, lang: string) {
  try { Speech.stop(); } catch { /* ignore */ }
  try {
    Speech.speak(text, {
      language: lang,
      rate: 0.92,
      pitch: 1.05,
    });
  } catch { /* non-fatal */ }
}

export default function OnboardingScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  const setHasCompletedOnboarding = useAuthStore((s) => s.setHasCompletedOnboarding);
  const setLanguage = useSettingsStore((s) => s.setLanguage);

  const [step, setStep] = useState<Step>(0);
  const [userName, setUserName] = useState('');
  const [selectedPersonality, setSelectedPersonality] = useState('default');
  const [selectedLang, setSelectedLang] = useState('es');
  const [loading, setLoading] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Speak when step changes
  useEffect(() => {
    const line = VOICE_LINES[step]?.[selectedLang] ?? VOICE_LINES[step]?.['es'];
    if (line) speakLine(line, selectedLang);
    return () => { try { Speech.stop(); } catch { /* ignore */ } };
  }, [step, selectedLang]);

  const animateToStep = (next: Step) => {
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: -20, duration: 120, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start();
    setStep(next);
  };

  const goNext = () => animateToStep(Math.min(step + 1, 6) as Step);

  const handleMicrophone = async () => {
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        selectedLang === 'en' ? 'Microphone required' : selectedLang === 'pt' ? 'Microfone necessário' : selectedLang === 'fr' ? 'Microphone requis' : 'Micrófono necesario',
        selectedLang === 'en' ? 'Without the microphone Leeloo cannot hear you. Enable it in phone Settings.' : selectedLang === 'pt' ? 'Sem o microfone a Leeloo não pode ouvir você.' : selectedLang === 'fr' ? 'Sans le microphone Leeloo ne peut pas vous entendre.' : 'Sin el micrófono Leeloo no puede escucharte. Puedes activarlo en Ajustes.',
        [{ text: 'OK' }],
      );
    }
    goNext();
  };

  const handleNotifications = async () => {
    await Notifications.requestPermissionsAsync();
    goNext();
  };

  const finishOnboarding = async () => {
    try { Speech.stop(); } catch { /* ignore */ }
    setLoading(true);
    try {
      const name = userName.trim() || undefined;
      await setLanguage(selectedLang as any);
      await profilesAPI.updateMe({
        preferred_language: selectedLang as any,
        leeloo_personality: selectedPersonality as any,
        ...(name ? { leeloo_name: name } : {}),
      }).catch(() => {});
      await setHasCompletedOnboarding(true, userId ?? undefined);
      router.replace('/(tabs)/home');
    } catch {
      await setHasCompletedOnboarding(true, userId ?? undefined);
      router.replace('/(tabs)/home');
    } finally {
      setLoading(false);
    }
  };

  const title = STEP_TITLES[step]?.[selectedLang] ?? STEP_TITLES[step]?.['es'] ?? '';
  const voiceLine = VOICE_LINES[step]?.[selectedLang] ?? VOICE_LINES[step]?.['es'] ?? '';

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={['#FFF9F6', '#F0EDFF', '#E8E0FF']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <WaveBackground opacity={0.07} cellSize={38} />

      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Progress bar */}
          <View style={s.progressBar}>
            <View style={[s.progressFill, { width: `${((step + 1) / TOTAL_STEPS) * 100}%` }]} />
          </View>

          <ScrollView
            contentContainerStyle={s.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View style={{ transform: [{ translateY: slideAnim }], alignItems: 'center' }}>
              {/* Icon card */}
              <LinearGradient
                colors={['#F07040', '#C4507A', '#8375FA']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={s.emojiCard}
              >
                <WaveBackground opacity={0.12} cellSize={28} />
                <Text style={s.emoji}>{STEP_EMOJIS[step]}</Text>
              </LinearGradient>

              <Text style={s.title}>{title}</Text>

              {/* Voice line bubble — shows what Leeloo is saying */}
              <View style={s.voiceBubble}>
                <Text style={s.voiceBubbleText}>🎙 {voiceLine}</Text>
              </View>

              {/* Step-specific content */}
              {step === 1 && (
                <View style={s.inputWrap}>
                  <TextInput
                    style={s.input}
                    placeholder={selectedLang === 'en' ? 'Your name or nickname...' : selectedLang === 'pt' ? 'Seu nome ou apelido...' : selectedLang === 'fr' ? 'Votre prénom ou surnom...' : 'Tu nombre o apodo...'}
                    placeholderTextColor="#AAA"
                    value={userName}
                    onChangeText={setUserName}
                    autoFocus
                    returnKeyType="next"
                    maxLength={30}
                  />
                </View>
              )}

              {step === 2 && (
                <View style={s.personalityGrid}>
                  {PERSONALITIES.map((p) => (
                    <TouchableOpacity
                      key={p.key}
                      style={[s.personalityCard, selectedPersonality === p.key && s.personalityCardActive]}
                      onPress={() => setSelectedPersonality(p.key)}
                      activeOpacity={0.75}
                    >
                      <Text style={s.personalityEmoji}>{p.emoji}</Text>
                      <Text style={[s.personalityLabel, selectedPersonality === p.key && s.personalityLabelActive]}>
                        {p.label[selectedLang as keyof typeof p.label] ?? p.label.es}
                      </Text>
                      <Text style={s.personalityDesc} numberOfLines={2}>
                        {p.desc[selectedLang as keyof typeof p.desc] ?? p.desc.es}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  <View style={s.personalityHint}>
                    <Text style={s.personalityHintText}>
                      {selectedLang === 'en'
                        ? '💡 You can change this anytime by voice: "Leeloo, change your personality to coach"'
                        : selectedLang === 'pt'
                        ? '💡 Você pode mudar isso a qualquer momento por voz: "Leeloo, mude sua personalidade para coach"'
                        : selectedLang === 'fr'
                        ? '💡 Vous pouvez changer cela à tout moment par la voix : "Leeloo, change ta personnalité en coach"'
                        : '💡 Puedes cambiarla en cualquier momento por voz: "Leeloo, cambia tu personalidad a coach"'}
                    </Text>
                  </View>
                </View>
              )}

              {step === 5 && (
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
          </ScrollView>

          {/* Footer buttons */}
          <View style={s.footer}>
            {step === 0 && (
              <PrimaryBtn onPress={goNext} label={selectedLang === 'en' ? "Let's go!" : selectedLang === 'pt' ? 'Vamos!' : selectedLang === 'fr' ? 'Allons-y !' : '¡Vamos!'} />
            )}

            {step === 1 && (
              <>
                <PrimaryBtn
                  onPress={goNext}
                  label={selectedLang === 'en' ? 'Continue' : selectedLang === 'pt' ? 'Continuar' : selectedLang === 'fr' ? 'Continuer' : 'Continuar'}
                />
                <SkipBtn onPress={goNext} lang={selectedLang} />
              </>
            )}

            {step === 2 && (
              <PrimaryBtn
                onPress={goNext}
                label={selectedLang === 'en' ? `Choose ${PERSONALITIES.find(p => p.key === selectedPersonality)?.label.en}` : selectedLang === 'pt' ? `Escolher ${PERSONALITIES.find(p => p.key === selectedPersonality)?.label.pt}` : selectedLang === 'fr' ? `Choisir ${PERSONALITIES.find(p => p.key === selectedPersonality)?.label.fr}` : `Elegir ${PERSONALITIES.find(p => p.key === selectedPersonality)?.label.es}`}
              />
            )}

            {step === 3 && (
              <>
                <PrimaryBtn onPress={handleMicrophone} label={selectedLang === 'en' ? 'Allow microphone' : selectedLang === 'pt' ? 'Permitir microfone' : selectedLang === 'fr' ? 'Autoriser le microphone' : 'Permitir micrófono'} />
                <SkipBtn onPress={goNext} lang={selectedLang} />
              </>
            )}

            {step === 4 && (
              <>
                <PrimaryBtn onPress={handleNotifications} label={selectedLang === 'en' ? 'Activate notifications' : selectedLang === 'pt' ? 'Ativar notificações' : selectedLang === 'fr' ? 'Activer les notifications' : 'Activar notificaciones'} />
                <SkipBtn onPress={goNext} lang={selectedLang} />
              </>
            )}

            {step === 5 && (
              <PrimaryBtn
                onPress={goNext}
                label={selectedLang === 'en' ? 'Continue' : selectedLang === 'pt' ? 'Continuar' : selectedLang === 'fr' ? 'Continuer' : 'Continuar'}
              />
            )}

            {step === 6 && (
              <PrimaryBtn
                onPress={finishOnboarding}
                loading={loading}
                label={loading
                  ? (selectedLang === 'en' ? 'Setting up...' : selectedLang === 'pt' ? 'Configurando...' : selectedLang === 'fr' ? 'Configuration...' : 'Configurando...')
                  : (selectedLang === 'en' ? '✨ Start with Leeloo' : selectedLang === 'pt' ? '✨ Começar com Leeloo' : selectedLang === 'fr' ? '✨ Commencer avec Leeloo' : '✨ ¡Empezar con Leeloo!')}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function PrimaryBtn({ onPress, label, loading }: { onPress: () => void; label: string; loading?: boolean }) {
  return (
    <TouchableOpacity
      style={[s.primaryBtnWrap, loading && s.disabled]}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.85}
    >
      <LinearGradient
        colors={['#F07040', '#C4507A', '#8375FA']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={s.primaryBtnGradient}
      >
        <Text style={s.primaryBtnText}>{label}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

function SkipBtn({ onPress, lang }: { onPress: () => void; lang: string }) {
  const label = lang === 'en' ? 'Skip for now' : lang === 'pt' ? 'Pular por agora' : lang === 'fr' ? 'Passer pour l\'instant' : 'Saltar por ahora';
  return (
    <TouchableOpacity style={s.skipBtn} onPress={onPress}>
      <Text style={s.skipText}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  progressBar: {
    height: 3,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 24,
    marginTop: 12,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: T.colors.purple,
    borderRadius: 2,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
  },
  emojiCard: {
    width: 90,
    height: 90,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: T.colors.orange,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 10,
  },
  emoji: { fontSize: 42 },
  title: {
    fontSize: 26,
    fontWeight: '800',
    fontFamily: T.fonts.bold,
    color: T.colors.navy,
    textAlign: 'center',
    lineHeight: 32,
    marginBottom: 12,
  },
  voiceBubble: {
    backgroundColor: 'rgba(131,117,250,0.08)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(131,117,250,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 20,
    maxWidth: SCREEN_WIDTH - 48,
  },
  voiceBubbleText: {
    fontSize: 14,
    color: '#4B4890',
    fontFamily: T.fonts.regular,
    lineHeight: 20,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  inputWrap: {
    width: '100%',
    marginTop: 4,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: T.colors.purple,
    paddingHorizontal: 18,
    paddingVertical: 14,
    fontSize: 18,
    fontFamily: T.fonts.semiBold,
    color: T.colors.navy,
    textAlign: 'center',
  },
  personalityGrid: {
    width: '100%',
    gap: 10,
  },
  personalityCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: T.colors.border,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  personalityCardActive: {
    borderColor: T.colors.purple,
    backgroundColor: '#F0EDFF',
  },
  personalityEmoji: { fontSize: 26 },
  personalityLabel: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    color: T.colors.muted,
    minWidth: 80,
  },
  personalityLabelActive: { color: T.colors.navy },
  personalityDesc: {
    flex: 1,
    fontSize: 12,
    color: T.colors.muted,
    fontFamily: T.fonts.regular,
    lineHeight: 17,
  },
  personalityHint: {
    backgroundColor: 'rgba(240,112,64,0.07)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(240,112,64,0.15)',
  },
  personalityHintText: {
    fontSize: 13,
    color: '#885533',
    fontFamily: T.fonts.regular,
    lineHeight: 18,
    textAlign: 'center',
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
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 8,
    gap: 10,
  },
  primaryBtnWrap: {
    borderRadius: T.radius.md,
    overflow: 'hidden',
    shadowColor: T.colors.orange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 6,
  },
  primaryBtnGradient: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: T.colors.white,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
  },
  skipBtn: { alignItems: 'center', paddingVertical: 10 },
  skipText: {
    color: '#9CA3AF',
    fontSize: 14,
    fontFamily: T.fonts.regular,
  },
  disabled: { opacity: 0.6 },
});
