import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth';
import { useSettingsStore } from '@/store/settings';

type SettingRow = {
  emoji: string;
  label: string;
  subtitle?: string;
  onPress: () => void;
  rightElement?: React.ReactNode;
  danger?: boolean;
};

function Row({ emoji, label, subtitle, onPress, rightElement, danger }: SettingRow) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.rowEmoji}>{emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]}>{label}</Text>
        {!!subtitle && <Text style={styles.rowSub}>{subtitle}</Text>}
      </View>
      {rightElement ?? <Text style={styles.rowArrow}>›</Text>}
    </TouchableOpacity>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const signOut = useAuthStore((s) => s.signOut);
  const session = useAuthStore((s) => s.session);
  const language = useSettingsStore((s) => s.language);

  const langLabels: Record<string, string> = {
    es: '🇨🇴 Español',
    en: '🇺🇸 English',
    pt: '🇧🇷 Português',
    fr: '🇫🇷 Français',
  };

  const handleSignOut = () => {
    Alert.alert('Cerrar sesión', '¿Segura que quieres salir?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar sesión',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/(auth)/sign-in');
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.pageTitle}>Configuración</Text>

        <Section title="Leeloo">
          <Row
            emoji="🧠"
            label="Personalidad"
            subtitle="Elige cómo quieres que sea Leeloo"
            onPress={() => router.push('/settings/personality')}
          />
          <View style={styles.divider} />
          <Row
            emoji="🔗"
            label="Integraciones"
            subtitle="Google, Microsoft, Calendar"
            onPress={() => router.push('/settings/integrations')}
          />
          <View style={styles.divider} />
          <Row
            emoji="🌍"
            label="Idioma"
            subtitle={langLabels[language] || language}
            onPress={() => router.push('/onboarding')}
          />
        </Section>

        <Section title="Cuenta">
          <Row emoji="👤" label="Mi perfil" subtitle={session?.userId ?? ''} onPress={() => {}} />
          <View style={styles.divider} />
          <Row
            emoji="🔔"
            label="Notificaciones"
            subtitle="Alertas y recordatorios"
            onPress={() => {}}
          />
        </Section>

        <Section title="Soporte">
          <Row emoji="❓" label="Ayuda y FAQ" onPress={() => {}} />
          <View style={styles.divider} />
          <Row emoji="⭐" label="Calificar Leeloo" onPress={() => {}} />
        </Section>

        <Section title="Sesión">
          <Row
            emoji="🚪"
            label="Cerrar sesión"
            onPress={handleSignOut}
            danger
            rightElement={<></>}
          />
        </Section>

        <Text style={styles.version}>Leeloo v1.0.0 · Hecho con 💜 para ti</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0B14', paddingHorizontal: 20 },
  pageTitle: { fontSize: 32, fontWeight: '800', color: '#FFFFFF', marginTop: 20, marginBottom: 24 },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#71717A',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionCard: {
    backgroundColor: '#17172A',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#27272A',
  },
  row: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
  rowEmoji: { fontSize: 22, width: 32, textAlign: 'center' },
  rowLabel: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  rowLabelDanger: { color: '#F87171' },
  rowSub: { fontSize: 12, color: '#71717A', marginTop: 2 },
  rowArrow: { color: '#3F3F46', fontSize: 22 },
  divider: { height: 1, backgroundColor: '#27272A', marginLeft: 62 },
  version: { fontSize: 12, color: '#3F3F46', textAlign: 'center', marginBottom: 40, marginTop: 8 },
});
