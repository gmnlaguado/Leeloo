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

export default function SettingsScreen() {
  const router = useRouter();
  const signOut = useAuthStore((s) => s.signOut);
  const session = useAuthStore((s) => s.session);
  const language = useSettingsStore((s) => s.language);

  const langLabels: Record<string, string> = {
    es: '🇨🇴 Español', en: '🇺🇸 English',
    pt: '🇧🇷 Português', fr: '🇫🇷 Français',
  };

  const handleSignOut = () => {
    Alert.alert('Cerrar sesión', '¿Segura que quieres salir?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar sesión', style: 'destructive',
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
            <Text style={s.headerTitle}>Configuración</Text>
            <Text style={s.headerSub}>Personaliza tu experiencia Leeloo</Text>
          </LinearGradient>

          <Section title="Leeloo">
            <Row
              emoji="🧠"
              label="Personalidad"
              subtitle="Elige cómo quieres que sea Leeloo"
              onPress={() => router.push('/settings/personality')}
            />
            <View style={s.divider} />
            <Row
              emoji="🔗"
              label="Integraciones"
              subtitle="Google, Microsoft, Calendar"
              onPress={() => router.push('/settings/integrations')}
            />
            <View style={s.divider} />
            <Row
              emoji="🌍"
              label="Idioma"
              subtitle={langLabels[language] || language}
              onPress={() => router.push('/onboarding')}
            />
          </Section>

          <Section title="Cuenta">
            <Row emoji="👤" label="Mi perfil" subtitle={session?.userId ?? ''} onPress={() => {}} />
            <View style={s.divider} />
            <Row emoji="🔔" label="Notificaciones" subtitle="Alertas y recordatorios" onPress={() => {}} />
          </Section>

          <Section title="Soporte">
            <Row emoji="❓" label="Ayuda y FAQ" onPress={() => {}} />
            <View style={s.divider} />
            <Row emoji="⭐" label="Calificar Leeloo" onPress={() => {}} />
          </Section>

          <Section title="Sesión">
            <Row emoji="🚪" label="Cerrar sesión" onPress={handleSignOut} danger />
          </Section>

          <Text style={s.version}>Leeloo v1.0.0 · Hecho con 💜 para ti</Text>
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
