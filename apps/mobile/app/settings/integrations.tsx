import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { integrationsAPI, type IntegrationProvider } from '@/lib/api';
import { useSettingsStore } from '@/store/settings';

WebBrowser.maybeCompleteAuthSession();

const I_STRINGS = {
  en: {
    title: 'Integrations', back: 'Back',
    sectionTitle: 'Connect your services',
    sectionSub: 'Leeloo will be able to read your calendar, email, and files to help you better.',
    connected: 'Connected', notConnected: 'Not connected',
    connect: 'Connect', disconnect: 'Disconnect', sync: '🔄 Sync',
    disconnectTitle: 'Disconnect', disconnectMsg: 'Are you sure you want to disconnect this integration?',
    cancel: 'Cancel',
    errConnect: 'Could not start the connection. Please try again.',
    errDisconnect: 'Could not disconnect. Please try again.',
    synced: '✅ Synced', syncedMsg: 'Data updated successfully.',
    errSync: 'Could not sync. Please try again.',
    googleDesc: 'Gmail, Google Calendar and Google Drive',
    microsoftDesc: 'Outlook, Teams and OneDrive',
  },
  es: {
    title: 'Integraciones', back: 'Atrás',
    sectionTitle: 'Conecta tus servicios',
    sectionSub: 'Leeloo podrá leer tu calendario, correo y archivos para ayudarte mejor.',
    connected: 'Conectado', notConnected: 'No conectado',
    connect: 'Conectar', disconnect: 'Desconectar', sync: '🔄 Sincronizar',
    disconnectTitle: 'Desconectar', disconnectMsg: '¿Segura que quieres desconectar esta integración?',
    cancel: 'Cancelar',
    errConnect: 'No se pudo iniciar la conexión. Intenta de nuevo.',
    errDisconnect: 'No se pudo desconectar. Intenta de nuevo.',
    synced: '✅ Sincronizado', syncedMsg: 'Los datos se actualizaron correctamente.',
    errSync: 'No se pudo sincronizar. Intenta de nuevo.',
    googleDesc: 'Gmail, Google Calendar y Google Drive',
    microsoftDesc: 'Outlook, Teams y OneDrive',
  },
  pt: {
    title: 'Integrações', back: 'Voltar',
    sectionTitle: 'Conecte seus serviços',
    sectionSub: 'A Leeloo poderá ler seu calendário, e-mail e arquivos para te ajudar melhor.',
    connected: 'Conectado', notConnected: 'Não conectado',
    connect: 'Conectar', disconnect: 'Desconectar', sync: '🔄 Sincronizar',
    disconnectTitle: 'Desconectar', disconnectMsg: 'Tem certeza que quer desconectar esta integração?',
    cancel: 'Cancelar',
    errConnect: 'Não foi possível iniciar a conexão. Tente novamente.',
    errDisconnect: 'Não foi possível desconectar. Tente novamente.',
    synced: '✅ Sincronizado', syncedMsg: 'Dados atualizados com sucesso.',
    errSync: 'Não foi possível sincronizar. Tente novamente.',
    googleDesc: 'Gmail, Google Calendar e Google Drive',
    microsoftDesc: 'Outlook, Teams e OneDrive',
  },
  fr: {
    title: 'Intégrations', back: 'Retour',
    sectionTitle: 'Connectez vos services',
    sectionSub: 'Leeloo pourra lire votre calendrier, vos e-mails et vos fichiers pour mieux vous aider.',
    connected: 'Connecté', notConnected: 'Non connecté',
    connect: 'Connecter', disconnect: 'Déconnecter', sync: '🔄 Synchroniser',
    disconnectTitle: 'Déconnecter', disconnectMsg: 'Êtes-vous sûr(e) de vouloir déconnecter cette intégration ?',
    cancel: 'Annuler',
    errConnect: 'Impossible de démarrer la connexion. Réessayez.',
    errDisconnect: 'Impossible de déconnecter. Réessayez.',
    synced: '✅ Synchronisé', syncedMsg: 'Données mises à jour avec succès.',
    errSync: 'Impossible de synchroniser. Réessayez.',
    googleDesc: 'Gmail, Google Agenda et Google Drive',
    microsoftDesc: 'Outlook, Teams et OneDrive',
  },
} as const;

type Integration = {
  provider: IntegrationProvider;
  label: string;
  emoji: string;
  connected: boolean;
};

export default function IntegrationsScreen() {
  const language = useSettingsStore((s) => s.language);
  const st = I_STRINGS[language] ?? I_STRINGS.en;

  const DEFAULT_INTEGRATIONS: Integration[] = [
    { provider: 'google', label: 'Google', emoji: '🔵', connected: false },
    { provider: 'microsoft', label: 'Microsoft', emoji: '🟦', connected: false },
  ];

  const [integrations, setIntegrations] = useState<Integration[]>(DEFAULT_INTEGRATIONS);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => { loadIntegrations(); }, []);

  const loadIntegrations = async () => {
    try {
      const res = await integrationsAPI.getIntegrations();
      const connected: string[] = Array.isArray((res.data as any)?.connected)
        ? (res.data as any).connected : [];
      setIntegrations((prev) => prev.map((i) => ({ ...i, connected: connected.includes(i.provider) })));
    } catch { /* keep defaults */ } finally { setLoading(false); }
  };

  const handleConnect = async (provider: IntegrationProvider) => {
    setActionLoading(provider);
    try {
      const redirectUri = 'leeloo://settings/integrations';
      const res = await integrationsAPI.getAuthUrl(provider, redirectUri);
      const url: string = (res.data as any)?.url;
      if (!url) throw new Error('No URL returned');

      const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);
      if (result.type === 'success' && result.url) {
        const params = new URLSearchParams(result.url.split('?')[1] || '');
        const code = params.get('code');
        const state = params.get('state');
        if (code && state) {
          await integrationsAPI.connectIntegration({ provider, authCode: code, state, redirectUri });
          setIntegrations((prev) => prev.map((i) => i.provider === provider ? { ...i, connected: true } : i));
        }
      }
    } catch {
      Alert.alert('Error', st.errConnect);
    } finally { setActionLoading(null); }
  };

  const handleDisconnect = (provider: IntegrationProvider) => {
    Alert.alert(st.disconnectTitle, st.disconnectMsg, [
      { text: st.cancel, style: 'cancel' },
      {
        text: st.disconnect, style: 'destructive',
        onPress: async () => {
          setActionLoading(provider);
          try {
            await integrationsAPI.disconnectIntegration(provider);
            setIntegrations((prev) => prev.map((i) => i.provider === provider ? { ...i, connected: false } : i));
          } catch { Alert.alert('Error', st.errDisconnect); }
          finally { setActionLoading(null); }
        },
      },
    ]);
  };

  const handleSync = async (provider: IntegrationProvider) => {
    setActionLoading(`${provider}-sync`);
    try {
      if (provider === 'google') {
        await Promise.all([integrationsAPI.syncGoogleCalendar(), integrationsAPI.syncGoogleGmail()]);
      } else {
        await integrationsAPI.syncMicrosoftCalendar();
      }
      Alert.alert(st.synced, st.syncedMsg);
    } catch { Alert.alert('Error', st.errSync); }
    finally { setActionLoading(null); }
  };

  const descFor = (provider: IntegrationProvider) =>
    provider === 'google' ? st.googleDesc : st.microsoftDesc;

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{
        title: st.title, headerBackTitle: st.back,
        headerStyle: { backgroundColor: '#0B0B14' },
        headerTintColor: '#fff',
      }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>{st.sectionTitle}</Text>
        <Text style={styles.sectionSub}>{st.sectionSub}</Text>

        {loading ? (
          <ActivityIndicator color="#7C3AED" style={{ marginTop: 40 }} />
        ) : (
          integrations.map((item) => {
            const isActing = actionLoading === item.provider || actionLoading === `${item.provider}-sync`;
            return (
              <View key={item.provider} style={[styles.card, item.connected && styles.cardConnected]}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardEmoji}>{item.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardLabel}>{item.label}</Text>
                    <Text style={styles.cardDesc}>{descFor(item.provider)}</Text>
                  </View>
                  <View style={[styles.badge, item.connected ? styles.badgeOn : styles.badgeOff]}>
                    <Text style={styles.badgeText}>{item.connected ? st.connected : st.notConnected}</Text>
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
                          <Text style={styles.actionBtnSecondaryText}>{st.sync}</Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.actionBtnDanger]}
                        onPress={() => handleDisconnect(item.provider)}
                        disabled={!!actionLoading}
                      >
                        <Text style={styles.actionBtnDangerText}>{st.disconnect}</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionBtnPrimary, !!actionLoading && styles.disabled]}
                      onPress={() => handleConnect(item.provider)}
                      disabled={!!actionLoading}
                    >
                      {isActing ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.actionBtnPrimaryText}>{st.connect} {item.label}</Text>
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
  card: { backgroundColor: '#17172A', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#27272A', gap: 14 },
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
  actionBtn: { flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', minHeight: 42 },
  actionBtnPrimary: { backgroundColor: '#7C3AED' },
  actionBtnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  actionBtnSecondary: { backgroundColor: '#1E1735', borderWidth: 1, borderColor: '#7C3AED' },
  actionBtnSecondaryText: { color: '#7C3AED', fontWeight: '600', fontSize: 14 },
  actionBtnDanger: { backgroundColor: '#3B1219', borderWidth: 1, borderColor: '#7F1D1D' },
  actionBtnDangerText: { color: '#F87171', fontWeight: '600', fontSize: 14 },
  disabled: { opacity: 0.5 },
});
