import { View, Text, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronRight, LogOut } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { useRouter } from 'expo-router';
import { useSettingsStore, SupportedLanguage } from '@/store/settings';

export default function SettingsScreen() {
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const signOut = useAuthStore((state) => state.signOut);
  const router = useRouter();
  const language = useSettingsStore((s) => s.language);
  const hydrate = useSettingsStore((s) => s.hydrate);
  const setLanguage = useSettingsStore((s) => s.setLanguage);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const handleSignOut = async () => {
    await signOut();
    // There is no dedicated auth/login route in this app — `/` (app/index.tsx)
    // is the real unauthenticated entry point in the file-based router.
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Language</Text>
        <View style={styles.languageRow}>
          {(['es', 'en', 'pt', 'fr'] as SupportedLanguage[]).map((lang) => {
            const selected = language === lang;
            return (
              <TouchableOpacity
                key={lang}
                style={[styles.languageChip, selected && styles.languageChipSelected]}
                onPress={() => setLanguage(lang)}
              >
                <Text
                  style={[styles.languageChipText, selected && styles.languageChipTextSelected]}
                >
                  {lang.toUpperCase()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Voice Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Voice</Text>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Wake Word Detection</Text>
          <Switch value={voiceEnabled} onValueChange={setVoiceEnabled} />
        </View>
      </View>

      {/* Notifications */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Push Notifications</Text>
          <Switch value={notificationsEnabled} onValueChange={setNotificationsEnabled} />
        </View>
      </View>

      {/* Account */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <TouchableOpacity style={styles.settingRow}>
          <Text style={styles.settingLabel}>Profile</Text>
          <ChevronRight size={20} color="#9CA3AF" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.settingRow}>
          <Text style={styles.settingLabel}>Integrations</Text>
          <ChevronRight size={20} color="#9CA3AF" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.settingRow}>
          <Text style={styles.settingLabel}>Privacy & Data</Text>
          <ChevronRight size={20} color="#9CA3AF" />
        </TouchableOpacity>
      </View>

      {/* Sign Out */}
      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <LogOut size={20} color="#EF4444" />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      <Text style={styles.version}>Version 0.1.0</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
  },
  languageRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  languageChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#fff',
  },
  languageChipSelected: {
    backgroundColor: '#8B5CF6',
    borderColor: '#8B5CF6',
  },
  languageChipText: {
    color: '#111827',
    fontWeight: '700',
  },
  languageChipTextSelected: {
    color: '#fff',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1F2937',
    marginTop: 20,
    marginBottom: 30,
  },
  section: {
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  settingLabel: {
    fontSize: 16,
    color: '#1F2937',
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    marginTop: 20,
    gap: 8,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#EF4444',
  },
  version: {
    textAlign: 'center',
    color: '#9CA3AF',
    fontSize: 14,
    marginTop: 30,
  },
});
