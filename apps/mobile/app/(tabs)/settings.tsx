import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth';
import { useSettingsStore } from '@/store/settings';
import { LinearGradient } from 'expo-linear-gradient';
import { WaveBackground } from '@/components/WaveBackground';
import { T } from '@/lib/theme';
import { ChevronRight } from 'lucide-react-native';

function Row({ emoji, label, subtitle, onPress, danger }: {
  emoji: string; label: string; subtitle?: string;
  onPress: () => void; danger?: boolean;
}) {
  return (
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={0.7}>
      <View style={s.rowIcon}>
        <Text style={{ fontSize: 20 }}>{emoji}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.rowLabel, danger && s.rowDanger]}>{label}</Text>
        {!!subtitle && <Text style={s.rowSub}>{subtitle}</Text>}
      </View>
      <ChevronRight size={18} color="#C4C0E0" strokeWidth={2} />
    </TouchableOpacity>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.sectionCard}>{children}</View>
    </View>
  );
}

const S_STRINGS = {
  en: {
    header: 'Settings', headerSub: 'Customize your Leeloo experience',
    secLeeloo: 'LEELOO', secAccount: 'ACCOUNT', secSupport: 'SUPPORT', secSession: 'SESSION',
    personality: 'Personality', personalitySub: 'Choose how you want Leeloo to be',
    integrations: 'Integrations', integrationsSub: 'Google, Microsoft, Calendar',
    language: 'Language',
    profile: 'My profile', notifications: 'Notifications', notificationsSub: 'Alerts and reminders',
    help: 'Help & FAQ', rate: 'Rate Leeloo',
    signOut: 'Sign out', signOutTitle: 'Sign out', signOutMsg: 'Are you sure you want to sign out?',
    cancel: 'Cancel', version: 'Leeloo v1.0.0 · Made with 💜 for you',
  },
  es: {
    header: 'Configuración', headerSub: 'Personaliza tu experiencia Leeloo',
    secLeeloo: 'LEELOO', secAccount: 'CUENTA', secSupport: 'SOPORTE', secSession: 'SESIÓN',
    personality: 'Personalidad', personalitySub: 'Elige cómo quieres que sea Leeloo',
    integrations: 'Integraciones', integrationsSub: 'Google, Microsoft, Calendar',
    language: 'Idioma',
    profile: 'Mi perfil', notifications: 'Notificaciones', notificationsSub: 'Alertas y recordatorios',
    help: 'Ayuda y FAQ', rate: 'Calificar Leeloo',
    signOut: 'Cerrar sesión', signOutTitle: 'Cerrar sesión', signOutMsg: '¿Segura que quieres salir?',
    cancel: 'Cancelar', version: 'Leeloo v1.0.0 · Hecho con 💜 para ti',
  },
  pt: {
    header: 'Configurações', headerSub: 'Personalize sua experiência Leeloo',
    secLeeloo: 'LEELOO', secAccount: 'CONTA', secSupport: 'SUPORTE', secSession: 'SESSÃO',
    personality: 'Personalidade', personalitySub: 'Escolha como você quer que a Leeloo seja',
    integrations: 'Integrações', integrationsSub: 'Google, Microsoft, Calendário',
    language: 'Idioma',
    profile: 'Meu perfil', notifications: 'Notificações', notificationsSub: 'Alertas e lembretes',
    help: 'Ajuda e FAQ', rate: 'Avaliar Leeloo',
    signOut: 'Sair', signOutTitle: 'Sair', signOutMsg: 'Tem certeza que quer sair?',
    cancel: 'Cancelar', version: 'Leeloo v1.0.0 · Feito com 💜 para você',
  },
  fr: {
    header: 'Paramètres', headerSub: 'Personnalisez votre expérience Leeloo',
    secLeeloo: 'LEELOO', secAccount: 'COMPTE', secSupport: 'SUPPORT', secSession: 'SESSION',
    personality: 'Personnalité', personalitySub: 'Choisissez comment vous voulez que Leeloo soit',
    integrations: 'Intégrations', integrationsSub: 'Google, Microsoft, Calendrier',
    language: 'Langue',
    profile: 'Mon profil', notifications: 'Notifications', notificationsSub: 'Alertes et rappels',
    help: 'Aide et FAQ', rate: 'Noter Leeloo',
    signOut: 'Se déconnecter', signOutTitle: 'Se déconnecter', signOutMsg: 'Êtes-vous sûr(e) de vouloir vous déconnecter ?',
    cancel: 'Annuler', version: 'Leeloo v1.0.0 · Fait avec 💜 pour vous',
  },
} as const;

export default function SettingsScreen() {
  const router = useRouter();
  const signOut = useAuthStore((s) => s.signOut);
  const session = useAuthStore((s) => s.session);
  const language = useSettingsStore((s) => s.language);

  const langLabels: Record<string, string> = {
    es: '🇨🇴 Español', en: '🇺🇸 English',
    pt: '🇧🇷 Português', fr: '🇫🇷 Français',
  };

  const st = S_STRINGS[language] ?? S_STRINGS.en;

  const handleSignOut = () => {
    Alert.alert(st.signOutTitle, st.signOutMsg, [
      { text: st.cancel, style: 'cancel' },
      { text: st.signOut, style: 'destructive',
        onPress: async () => { await signOut(); router.replace('/(auth)/sign-in'); } },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: T.colors.cream }}>
      <WaveBackground opacity={0.055} cellSize={38} />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <LinearGradient
            colors={['#F07040', '#C4507A', '#8375FA']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.headerCard}
          >
            <WaveBackground opacity={0.12} cellSize={30} />
            <Text style={s.headerTitle}>{st.header}</Text>
            <Text style={s.headerSub}>{st.headerSub}</Text>
          </LinearGradient>

          <Section title={st.secLeeloo}>
            <Row
              emoji="🧠"
              label={st.personality}
              subtitle={st.personalitySub}
              onPress={() => router.push('/settings/personality')}
            />
            <View style={s.divider} />
            <Row
              emoji="🔗"
              label={st.integrations}
              subtitle={st.integrationsSub}
              onPress={() => router.push('/settings/integrations')}
            />
            <View style={s.divider} />
            <Row
              emoji="🌍"
              label={st.language}
              subtitle={langLabels[language] || language}
              onPress={() => router.push('/onboarding')}
            />
          </Section>

          <Section title={st.secAccount}>
            <Row emoji="👤" label={st.profile} subtitle={session?.userId ?? ''} onPress={() => {}} />
            <View style={s.divider} />
            <Row emoji="🔔" label={st.notifications} subtitle={st.notificationsSub} onPress={() => {}} />
          </Section>

          <Section title={st.secSupport}>
            <Row emoji="❓" label={st.help} onPress={() => {}} />
            <View style={s.divider} />
            <Row emoji="⭐" label={st.rate} onPress={() => {}} />
          </Section>

          <Section title={st.secSession}>
            <Row emoji="🚪" label={st.signOut} onPress={handleSignOut} danger />
          </Section>

          <Text style={s.version}>{st.version}</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  headerCard: {
    borderRadius: T.radius.lg,
    padding: 24,
    marginBottom: 24,
    overflow: 'hidden',
    gap: 4,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    color: T.colors.white,
  },
  headerSub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    fontFamily: T.fonts.regular,
  },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    color: '#8F8BB8',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionCard: {
    backgroundColor: T.colors.white,
    borderRadius: T.radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#EDE9F8',
    shadowColor: T.colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F0EDFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: T.fonts.semiBold,
    color: T.colors.navy,
  },
  rowDanger: { color: '#DC2626' },
  rowSub: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
    fontFamily: T.fonts.regular,
  },
  divider: { height: 1, backgroundColor: '#EDE9F8', marginLeft: 64 },
  version: {
    fontSize: 12,
    color: '#C4C0E0',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
    fontFamily: T.fonts.regular,
  },
});
