import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { integrationsAPI, type IntegrationProvider } from '@/lib/api';

type Integration = {
  provider: IntegrationProvider;
  label: string;
  emoji: string;
  description: string;
  connected: boolean;
  scopes?: string[];
};

const DEFAULT_INTEGRATIONS: Integration[] = [
  {
    provider: 'google',
    label: 'Google',
    emoji: '🔵',
    description: 'Gmail, Google Calendar y Google Drive',
    connected: false,
  },
  {
    provider: 'microsoft',
    label: 'Microsoft',
    emoji: '🟦',
    description: 'Outlook, Teams y OneDrive',
    connected: false,
  },
];

export default function IntegrationsScreen() {
  const router = useRouter();
  const [integrations, setIntegrations] = useState<Integration[]>(DEFAULT_INTEGRATIONS);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    loadIntegrations();
  }, []);

  const loadIntegrations = async () => {
    try {
      const res = await integrationsAPI.getIntegrations();
      const connected: string[] = Array.isArray((res.data as any)?.connected)
        ? (res.data as any).connected
        : [];
      setIntegrations((prev) =>
        prev.map((i) => ({ ...i, connected: connected.includes(i.provider) })),
      );
    } catch {
      // keep defaults
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (provider: IntegrationProvider) => {
    setActionLoading(provider);
    try {
      const redirectUri = 'leeloo://integrations/callback';
      const res = await integrationsAPI.getAuthUrl(provider, redirectUri);
      const url: string = (res.data as any)?.url;
      if (!url) throw new Error('No URL returned');
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('Error', 'No se pudo iniciar la conexión. Intenta de nuevo.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDisconnect = (provider: IntegrationProvider) => {
    Alert.alert('Desconectar', '¿Segura que quieres desconectar esta integración?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Desconectar',
        style: 'destructive',
        onPress: async () => {
          setActionLoading(provider);
          try {
            await integrationsAPI.disconnectIntegration(provider);
            setIntegrations((prev) =>
              prev.map((i) => (i.provider === provider ? { ...i, connected: false } : i)),
            );
          } catch {
            Alert.alert('Error', 'No se pudo desconectar. Intenta de nuevo.');
          } finally {
            setActionLoading(null);
          }
        },
      },
    ]);
  };

  const handleSync = async (provider: IntegrationProvider) => {
    setActionLoading(`${provider}-sync`);
    try {
      if (provider === 'google') {
        await Promise.all([
          integrationsAPI.syncGoogleCalendar(),
          integrationsAPI.syncGoogleGmail(),
        ]);
      } else {
        await integrationsAPI.syncMicrosoftCalendar();
      }
      Alert.alert('✅ Sincronizado', 'Los datos se actualizaron correctamente.');
    } catch {
      Alert.alert('Error', 'No se pudo sincronizar. Intenta de nuevo.');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Integraciones',
          headerBackTitle: 'Atrás',
          headerStyle: { backgroundColor: '#0B0B14' },
          headerTintColor: '#fff',
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Conecta tus servicios</Text>
        <Text style={styles.sectionSub}>
          Leeloo podrá leer tu calendario, correo y archivos para ayudarte mejor.
        </Text>

        {loading ? (
          <ActivityIndicator color="#7C3AED" style={{ marginTop: 40 }} />
        ) : (
          integrations.map((item) => {
            const isActing =
              actionLoading === item.provider || actionLoading === `${item.provider}-sync`;
            return (
              <View
                key={item.provider}
                style={[styles.card, item.connected && styles.cardConnected]}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.cardEmoji}>{item.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardLabel}>{item.label}</Text>
                    <Text style={styles.cardDesc}>{item.description}</Text>
                  </View>
                  <View style={[styles.badge, item.connected ? styles.badgeOn : styles.badgeOff]}>
                    <Text style={styles.badgeText}>
                      {item.connected ? 'Conectado' : 'No conectado'}
                    </Text>
                  </View>
                </View>

                <View style={styles.cardActions}>
                  {item.connected ? (
                    <>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.actionBtnSecondary]}
                        onPress={() => handleSync(item.provider)}
                        disabled={!!actionLoading}
                      >
                        {isActing && actionLoading === `${item.provider}-sync` ? (
                          <ActivityIndicator color="#7C3AED" size="small" />
                        ) : (
                          <Text style={styles.actionBtnSecondaryText}>🔄 Sincronizar</Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.actionBtnDanger]}
                        onPress={() => handleDisconnect(item.provider)}
                        disabled={!!actionLoading}
                      >
                        <Text style={styles.actionBtnDangerText}>Desconectar</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity
                      style={[
                        styles.actionBtn,
                        styles.actionBtnPrimary,
                        !!actionLoading && styles.disabled,
                      ]}
                      onPress={() => handleConnect(item.provider)}
                      disabled={!!actionLoading}
                    >
                      {isActing ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.actionBtnPrimaryText}>Conectar {item.label}</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0B14' },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  sectionSub: { fontSize: 14, color: '#A1A1AA', lineHeight: 20 },
  card: {
    backgroundColor: '#17172A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#27272A',
    gap: 14,
  },
  cardConnected: { borderColor: '#7C3AED' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardEmoji: { fontSize: 32 },
  cardLabel: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  cardDesc: { fontSize: 13, color: '#71717A', marginTop: 2 },
  badge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  badgeOn: { backgroundColor: '#14532D' },
  badgeOff: { backgroundColor: '#27272A' },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#fff' },
  cardActions: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
  },
  actionBtnPrimary: { backgroundColor: '#7C3AED' },
  actionBtnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  actionBtnSecondary: { backgroundColor: '#1E1735', borderWidth: 1, borderColor: '#7C3AED' },
  actionBtnSecondaryText: { color: '#7C3AED', fontWeight: '600', fontSize: 14 },
  actionBtnDanger: { backgroundColor: '#3B1219', borderWidth: 1, borderColor: '#7F1D1D' },
  actionBtnDangerText: { color: '#F87171', fontWeight: '600', fontSize: 14 },
  disabled: { opacity: 0.5 },
});
