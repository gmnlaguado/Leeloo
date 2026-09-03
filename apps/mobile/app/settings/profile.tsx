import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { WaveBackground } from '@/components/WaveBackground';
import { T } from '@/lib/theme';
import { memoriesAPI } from '@/lib/api';
import { useSettingsStore } from '@/store/settings';

type Memory = {
  id: string;
  key: string;
  value: { content?: string } | string | null;
  category: string;
  created_at?: string;
};

function memoryText(m: Memory): string {
  if (typeof m.value === 'object' && m.value !== null && typeof m.value.content === 'string') {
    return m.value.content;
  }
  if (typeof m.value === 'string') return m.value;
  return m.key.replace(/_/g, ' ');
}

const CATEGORY_ICONS: Record<string, string> = {
  preference: '❤️',
  family: '👨‍👩‍👧',
  work: '💼',
  goal: '🎯',
  routine: '🔄',
  spiritual: '🙏',
  contact: '📞',
  birthday: '🎂',
  school: '📚',
  general: '📝',
  other: '📌',
};

const CATEGORY_ORDER = [
  'preference', 'family', 'work', 'goal',
  'routine', 'spiritual', 'contact', 'birthday', 'school', 'general', 'other',
];

const ST = {
  en: {
    title: 'My Profile',
    sub: 'Everything Leeloo knows about you',
    empty: "Leeloo doesn't know you yet.\nTell her things like \"My favorite food is sushi\" or \"My son's name is Lucas\".",
    addLabel: 'Add something Leeloo should know...',
    addPlaceholder: 'e.g. My favorite music is jazz',
    save: 'Save',
    tip: 'You can also tell Leeloo by voice — she\'ll remember everything.',
    errLoad: 'Could not load your profile.',
    errSave: 'Could not save. Please try again.',
    saved: 'Saved!',
  },
  es: {
    title: 'Mi Perfil',
    sub: 'Todo lo que Leeloo sabe de ti',
    empty: 'Leeloo todavía no te conoce bien.\nCuéntale cosas como "Mi comida favorita es el sushi" o "Mi hijo se llama Lucas".',
    addLabel: 'Agrega algo que Leeloo debería saber...',
    addPlaceholder: 'Ej: Mi música favorita es el jazz',
    save: 'Guardar',
    tip: 'También puedes contárselo por voz — ella lo recuerda todo.',
    errLoad: 'No se pudo cargar tu perfil.',
    errSave: 'No se pudo guardar. Intenta de nuevo.',
    saved: '¡Guardado!',
  },
  pt: {
    title: 'Meu Perfil',
    sub: 'Tudo que a Leeloo sabe sobre você',
    empty: 'A Leeloo ainda não te conhece.\nConte coisas como "Minha comida favorita é o sushi" ou "Meu filho se chama Lucas".',
    addLabel: 'Adicione algo que Leeloo deveria saber...',
    addPlaceholder: 'Ex: Minha música favorita é jazz',
    save: 'Salvar',
    tip: 'Você também pode falar por voz — ela lembra de tudo.',
    errLoad: 'Não foi possível carregar seu perfil.',
    errSave: 'Não foi possível salvar. Tente novamente.',
    saved: 'Salvo!',
  },
  fr: {
    title: 'Mon Profil',
    sub: 'Tout ce que Leeloo sait de vous',
    empty: "Leeloo ne vous connaît pas encore.\nDites-lui des choses comme \"Ma cuisine préférée est les sushis\" ou \"Mon fils s'appelle Lucas\".",
    addLabel: 'Ajoutez quelque chose que Leeloo devrait savoir...',
    addPlaceholder: 'Ex: Ma musique préférée est le jazz',
    save: 'Enregistrer',
    tip: 'Vous pouvez aussi le dire à voix haute — elle se souvient de tout.',
    errLoad: 'Impossible de charger votre profil.',
    errSave: "Impossible d'enregistrer. Veuillez réessayer.",
    saved: 'Enregistré !',
  },
} as const;

function groupByCategory(memories: Memory[]): Map<string, Memory[]> {
  const map = new Map<string, Memory[]>();
  for (const m of memories) {
    const cat = m.category || 'other';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(m);
  }
  return map;
}

export default function ProfileScreen() {
  const language = useSettingsStore((s) => s.language);
  const st = ST[language] ?? ST.es;

  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState('');
  const [saving, setSaving] = useState(false);

  const loadMemories = useCallback(async () => {
    try {
      const res = await memoriesAPI.list({ limit: 100 });
      const data = res.data as any;
      // API returns a plain array — exclude conversation turns (too noisy for profile view)
      const raw: Memory[] = Array.isArray(data?.memories)
        ? data.memories
        : Array.isArray(data)
          ? data
          : [];
      const items = raw.filter((m) => m.category !== 'conversation_turn');
      setMemories(items);
    } catch {
      Alert.alert('Error', st.errLoad);
    } finally {
      setLoading(false);
    }
  }, [st.errLoad]);

  useEffect(() => { loadMemories(); }, [loadMemories]);
  useFocusEffect(useCallback(() => { loadMemories(); }, [loadMemories]));

  const handleSave = async () => {
    const text = newText.trim();
    if (!text) return;
    setSaving(true);
    try {
      await memoriesAPI.save(text, 'preference');
      setNewText('');
      await loadMemories();
      Alert.alert('', st.saved);
    } catch {
      Alert.alert('Error', st.errSave);
    } finally {
      setSaving(false);
    }
  };

  const grouped = groupByCategory(memories);
  const sortedCategories = CATEGORY_ORDER.filter((c) => grouped.has(c));
  // Add any unexpected categories not in CATEGORY_ORDER
  for (const cat of grouped.keys()) {
    if (!sortedCategories.includes(cat)) sortedCategories.push(cat);
  }

  return (
    <SafeAreaView style={s.container}>
      <Stack.Screen options={{
        title: st.title,
        headerBackTitle: language === 'en' ? 'Back' : language === 'pt' ? 'Voltar' : language === 'fr' ? 'Retour' : 'Atrás',
        headerStyle: { backgroundColor: T.colors.navy },
        headerTintColor: T.colors.white,
      }} />
      <WaveBackground opacity={0.04} cellSize={38} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <Text style={s.heading}>{st.title}</Text>
          <Text style={s.sub}>{st.sub}</Text>

          {/* Add new */}
          <View style={s.addCard}>
            <Text style={s.addLabel}>{st.addLabel}</Text>
            <TextInput
              style={s.input}
              value={newText}
              onChangeText={setNewText}
              placeholder={st.addPlaceholder}
              placeholderTextColor={T.colors.muted}
              multiline
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[s.saveBtn, (!newText.trim() || saving) && s.disabled]}
              onPress={handleSave}
              disabled={!newText.trim() || saving}
            >
              {saving
                ? <ActivityIndicator color={T.colors.white} size="small" />
                : <Text style={s.saveBtnText}>{st.save}</Text>
              }
            </TouchableOpacity>
          </View>

          <Text style={s.tip}>💬 {st.tip}</Text>

          {/* Memory sections */}
          {loading ? (
            <ActivityIndicator color={T.colors.purple} style={{ marginTop: 32 }} />
          ) : memories.length === 0 ? (
            <View style={s.emptyBox}>
              <Text style={s.emptyEmoji}>🌱</Text>
              <Text style={s.emptyText}>{st.empty}</Text>
            </View>
          ) : (
            sortedCategories.map((cat) => (
              <View key={cat} style={s.section}>
                <View style={s.sectionHeader}>
                  <Text style={s.catIcon}>{CATEGORY_ICONS[cat] ?? '📌'}</Text>
                  <Text style={s.catTitle}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</Text>
                  <View style={s.countBadge}>
                    <Text style={s.countText}>{grouped.get(cat)!.length}</Text>
                  </View>
                </View>
                {grouped.get(cat)!.map((m) => (
                  <View key={m.id} style={s.memCard}>
                    <Text style={s.memText}>{memoryText(m)}</Text>
                    {m.created_at && (
                      <Text style={s.memDate}>
                        {new Date(m.created_at).toLocaleDateString()}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.colors.cream },
  scroll: { padding: 20, paddingBottom: 48, gap: 16 },
  heading: {
    fontSize: 32,
    fontWeight: '800',
    fontFamily: T.fonts.bold,
    color: T.colors.navy,
    marginTop: 4,
  },
  sub: {
    fontSize: 14,
    color: T.colors.muted,
    fontFamily: T.fonts.regular,
    marginTop: 2,
    marginBottom: 4,
  },
  addCard: {
    backgroundColor: T.colors.white,
    borderRadius: T.radius.lg,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: T.colors.border,
    shadowColor: T.colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  addLabel: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: T.fonts.semiBold,
    color: T.colors.navy,
  },
  input: {
    minHeight: 52,
    fontSize: 15,
    fontFamily: T.fonts.regular,
    color: T.colors.navy,
    backgroundColor: T.colors.cream,
    borderRadius: T.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: T.colors.border,
  },
  saveBtn: {
    backgroundColor: T.colors.purple,
    borderRadius: T.radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveBtnText: {
    color: T.colors.white,
    fontWeight: '700',
    fontSize: 15,
    fontFamily: T.fonts.bold,
  },
  disabled: { opacity: 0.4 },
  tip: {
    fontSize: 13,
    color: T.colors.muted,
    fontFamily: T.fonts.regular,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  emptyBox: {
    alignItems: 'center',
    paddingTop: 32,
    gap: 12,
    paddingHorizontal: 16,
  },
  emptyEmoji: { fontSize: 52 },
  emptyText: {
    fontSize: 14,
    color: T.colors.muted,
    textAlign: 'center',
    lineHeight: 22,
    fontFamily: T.fonts.regular,
  },
  section: { gap: 8 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  catIcon: { fontSize: 18 },
  catTitle: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    color: T.colors.navy,
    flex: 1,
  },
  countBadge: {
    backgroundColor: T.colors.purple,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countText: {
    color: T.colors.white,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
  },
  memCard: {
    backgroundColor: T.colors.white,
    borderRadius: T.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: T.colors.border,
    gap: 4,
    shadowColor: T.colors.navy,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  memText: {
    fontSize: 14,
    color: T.colors.navy,
    fontFamily: T.fonts.regular,
    lineHeight: 20,
  },
  memDate: {
    fontSize: 11,
    color: T.colors.muted,
    fontFamily: T.fonts.regular,
  },
});
