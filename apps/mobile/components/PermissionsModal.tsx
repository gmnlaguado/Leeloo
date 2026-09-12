/**
 * PermissionsModal.tsx
 *
 * Shows on first launch (after sign-in) to request all Leeloo permissions.
 * Re-shows if the microphone permission is missing on subsequent launches.
 * Each permission has a clear explanation of what it enables and what breaks
 * without it, so the user can make an informed decision.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  type PermissionKey,
  type PermissionStatus,
  checkAllPermissions,
  requestPermission,
} from '@/services/permissions.service';

const STORAGE_KEY = 'leeloo.permissions.shown_v1';

// ── Permission metadata ────────────────────────────────────────────────────
interface PermInfo {
  key: PermissionKey;
  icon: string;
  title: string;
  why: string;       // short "needed for X"
  broken: string;    // what breaks without it
  critical: boolean;
  androidOnly?: boolean;
}

const PERMISSIONS: PermInfo[] = [
  {
    key: 'microphone',
    icon: '🎙️',
    title: 'Micrófono',
    why: 'Para escucharte y entender tus comandos de voz.',
    broken: 'Sin este permiso Leeloo no puede funcionar — es el más importante.',
    critical: true,
  },
  {
    key: 'notifications',
    icon: '🔔',
    title: 'Notificaciones',
    why: 'Para enviarte recordatorios y alertas de tareas.',
    broken: 'No recibirás recordatorios de tareas ni eventos.',
    critical: false,
  },
  {
    key: 'contacts',
    icon: '👤',
    title: 'Contactos',
    why: 'Para encontrar el número de tus contactos cuando dices "llama a Juan".',
    broken: 'Tendrás que decir el número completo en vez del nombre.',
    critical: false,
  },
  {
    key: 'calendar',
    icon: '📅',
    title: 'Calendario',
    why: 'Para crear y leer eventos en tu agenda.',
    broken: 'No podrá crear eventos ni mostrarte tu agenda.',
    critical: false,
  },
  {
    key: 'calls',
    icon: '📞',
    title: 'Llamadas automáticas',
    why: 'Para marcar llamadas sin que tengas que tocar la pantalla.',
    broken: 'Abrirá el marcador pero tendrás que presionar "Llamar" tú mismo.',
    critical: false,
    androidOnly: true,
  },
];

// ── Component ──────────────────────────────────────────────────────────────
interface Props {
  visible: boolean;
  onDone: () => void;
}

export function PermissionsModal({ visible, onDone }: Props) {
  const [statuses, setStatuses] = useState<Record<PermissionKey, boolean>>({
    microphone: false,
    calls: true,
    contacts: false,
    calendar: false,
    notifications: false,
  });
  const [requesting, setRequesting] = useState<PermissionKey | null>(null);
  const [done, setDone] = useState(false);

  // Load current permission states when modal opens
  useEffect(() => {
    if (!visible) return;
    checkAllPermissions().then((list: PermissionStatus[]) => {
      const map = { ...statuses };
      for (const s of list) map[s.key] = s.granted;
      setStatuses(map);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleRequest = useCallback(async (key: PermissionKey) => {
    setRequesting(key);
    const granted = await requestPermission(key);
    setStatuses((prev) => ({ ...prev, [key]: granted }));
    setRequesting(null);
  }, []);

  const handleRequestAll = useCallback(async () => {
    const visible_perms = PERMISSIONS.filter(
      (p) => !p.androidOnly || Platform.OS === 'android',
    );
    for (const p of visible_perms) {
      if (!statuses[p.key]) {
        await handleRequest(p.key);
      }
    }
    setDone(true);
  }, [statuses, handleRequest]);

  const handleClose = useCallback(async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '1').catch(() => {});
    onDone();
  }, [onDone]);

  const micGranted = statuses['microphone'];
  const allGranted = PERMISSIONS.filter(
    (p) => !p.androidOnly || Platform.OS === 'android',
  ).every((p) => statuses[p.key]);

  const visiblePerms = PERMISSIONS.filter(
    (p) => !p.androidOnly || Platform.OS === 'android',
  );

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={s.overlay}>
        <View style={s.card}>
          {/* Header */}
          <View style={s.header}>
            <Text style={s.emoji}>🤖</Text>
            <Text style={s.title}>Para funcionar al 100%{'\n'}necesito estos permisos</Text>
            <Text style={s.subtitle}>
              Puedes denegarlos pero algunas funciones no estarán disponibles.
            </Text>
          </View>

          {/* Permission list */}
          <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
            {visiblePerms.map((p) => {
              const granted = statuses[p.key];
              const loading = requesting === p.key;
              return (
                <View key={p.key} style={[s.row, granted && s.rowGranted]}>
                  <Text style={s.rowIcon}>{p.icon}</Text>
                  <View style={s.rowText}>
                    <View style={s.rowTitleRow}>
                      <Text style={s.rowTitle}>{p.title}</Text>
                      {p.critical && (
                        <View style={s.badge}>
                          <Text style={s.badgeText}>Requerido</Text>
                        </View>
                      )}
                    </View>
                    <Text style={s.rowWhy}>{p.why}</Text>
                    {!granted && (
                      <Text style={s.rowBroken}>⚠️ {p.broken}</Text>
                    )}
                  </View>
                  <Pressable
                    style={[s.btn, granted && s.btnGranted]}
                    onPress={() => !granted && handleRequest(p.key)}
                    disabled={granted || loading}
                  >
                    {loading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={[s.btnText, granted && s.btnTextGranted]}>
                        {granted ? '✓' : 'Dar'}
                      </Text>
                    )}
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>

          {/* Footer */}
          {!micGranted && (
            <View style={s.criticalBanner}>
              <Text style={s.criticalText}>
                ⚠️ Sin el micrófono Leeloo no puede funcionar
              </Text>
            </View>
          )}

          <View style={s.footer}>
            {!allGranted && !done && (
              <Pressable style={s.primaryBtn} onPress={handleRequestAll}>
                <Text style={s.primaryBtnText}>Dar todos los permisos</Text>
              </Pressable>
            )}
            <Pressable
              style={[s.secondaryBtn, allGranted && s.primaryBtn]}
              onPress={handleClose}
            >
              <Text style={[s.secondaryBtnText, allGranted && s.primaryBtnText]}>
                {allGranted ? '¡Listo, continuar!' : 'Continuar sin algunos permisos'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Returns true if the permissions modal should be shown */
export async function shouldShowPermissionsModal(): Promise<boolean> {
  // Always show if microphone isn't granted
  const statuses = await checkAllPermissions();
  const micGranted = statuses.find((s) => s.key === 'microphone')?.granted ?? false;
  if (!micGranted) return true;

  // Otherwise show only once
  const shown = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
  return shown !== '1';
}

// ── Styles ─────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#1a1040',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '90%',
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  emoji: {
    fontSize: 44,
    marginBottom: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    lineHeight: 28,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: '#a89fd0',
    textAlign: 'center',
    lineHeight: 18,
  },
  list: {
    maxHeight: 360,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#261850',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#3d2870',
  },
  rowGranted: {
    borderColor: '#7c3aed',
    backgroundColor: '#1e1245',
  },
  rowIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  rowText: {
    flex: 1,
    marginRight: 10,
  },
  rowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  badge: {
    backgroundColor: '#7c3aed',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: '600',
  },
  rowWhy: {
    fontSize: 12,
    color: '#c4b8e8',
    lineHeight: 16,
    marginBottom: 2,
  },
  rowBroken: {
    fontSize: 11,
    color: '#f97316',
    lineHeight: 15,
    marginTop: 2,
  },
  btn: {
    backgroundColor: '#7c3aed',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minWidth: 52,
    alignItems: 'center',
  },
  btnGranted: {
    backgroundColor: '#22c55e',
  },
  btnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  btnTextGranted: {
    fontSize: 18,
  },
  criticalBanner: {
    backgroundColor: '#7c1d1d',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  criticalText: {
    color: '#fca5a5',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '600',
  },
  footer: {
    marginTop: 14,
    gap: 10,
  },
  primaryBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    backgroundColor: 'transparent',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#a89fd0',
    fontSize: 14,
  },
});
