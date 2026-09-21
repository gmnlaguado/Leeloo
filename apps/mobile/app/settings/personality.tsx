import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { WaveBackground } from '@/components/WaveBackground';
import { T } from '@/lib/theme';
import { profilesAPI } from '../../lib/api';
import { useSettingsStore } from '@/store/settings';

type PersonalityId =
  | 'default' | 'christian' | 'coach' | 'mentor'
  | 'business' | 'counselor' | 'faith' | 'motivation' | 'balanced' | 'nurturing';

const P_STRINGS = {
  en: {
    title: 'Leeloo Personality', sub: 'You can change this anytime.',
    multiNote: 'Multiple selections allowed.',
    activeLabel: 'Active personalities:', save: 'Save selection',
    errSave: 'Could not save. Try again.',
    descs: {
      faith: 'Spirituality & purpose',
      business: 'Maximum productivity',
      counselor: 'Deep listening',
      balanced: 'Full balance',
      mentor: 'Growth & purpose',
      motivation: 'Goals & discipline',
      nurturing: 'Warmth & support',
      christian: 'Faith, prayer & grace',
      coach: 'Accountability',
      default: 'Organized & empathetic',
    },
  },
  es: {
    title: 'Personalidad de Leeloo', sub: 'Puedes cambiar esto en cualquier momento.',
    multiNote: 'Puedes seleccionar varias personalidades.',
    activeLabel: 'Personalidades activas:', save: 'Guardar selección',
    errSave: 'No se pudo guardar. Intenta de nuevo.',
    descs: {
      faith: 'Espiritualidad y propósito',
      business: 'Productividad máxima',
      counselor: 'Escucha profunda',
      balanced: 'Equilibrio integral',
      mentor: 'Crecimiento y propósito',
      motivation: 'Metas y disciplina',
      nurturing: 'Calidez y apoyo',
      christian: 'Fe, oración y gracia',
      coach: 'Accountability',
      default: 'Organizada y empática',
    },
  },
  pt: {
    title: 'Personalidade da Leeloo', sub: 'Você pode mudar isso a qualquer momento.',
    multiNote: 'Você pode selecionar várias personalidades.',
    activeLabel: 'Personalidades ativas:', save: 'Salvar seleção',
    errSave: 'Não foi possível salvar. Tente novamente.',
    descs: {
      faith: 'Espiritualidade e propósito',
      business: 'Produtividade máxima',
      counselor: 'Escuta profunda',
      balanced: 'Equilíbrio integral',
      mentor: 'Crescimento e propósito',
      motivation: 'Metas e disciplina',
      nurturing: 'Calor e apoio',
      christian: 'Fé, oração e graça',
      coach: 'Responsabilidade',
      default: 'Organizada e empática',
    },
  },
  fr: {
    title: 'Personnalité de Leeloo', sub: 'Vous pouvez changer cela à tout moment.',
    multiNote: 'Vous pouvez sélectionner plusieurs personnalités.',
    activeLabel: 'Personnalités actives :', save: 'Enregistrer la sélection',
    errSave: 'Impossible de sauvegarder. Réessayez.',
    descs: {
      faith: 'Spiritualité et sens',
      business: 'Productivité maximale',
      counselor: 'Écoute profonde',
      balanced: 'Équilibre global',
      mentor: 'Croissance et sens',
      motivation: 'Objectifs et discipline',
      nurturing: 'Chaleur et soutien',
      christian: 'Foi, prière et grâce',
      coach: 'Responsabilité',
      default: 'Organisée et empathique',
    },
  },
} as const;

const PERSONALITY_IDS: { id: PersonalityId; emoji: string }[] = [
  { id: 'faith',      emoji: '🕊️' },
  { id: 'business',   emoji: '💼' },
  { id: 'counselor',  emoji: '💜' },
  { id: 'balanced',   emoji: '⚖️' },
  { id: 'mentor',     emoji: '🌱' },
  { id: 'motivation', emoji: '🎯' },
  { id: 'nurturing',  emoji: '🌸' },
  { id: 'christian',  emoji: '✝️' },
  { id: 'coach',      emoji: '⚡' },
  { id: 'default',    emoji: '⭐' },
];

const LABELS: Record<PersonalityId, string> = {
  faith: 'Faith', business: 'Business', counselor: 'Counselor',
  balanced: 'Balanced', mentor: 'Mentor', motivation: 'Motivation',
  nurturing: 'Nurturing', christian: 'Christian', coach: 'Coach', default: 'Leeloo',
};

function parseSelected(raw: string | undefined): Set<PersonalityId> {
  if (!raw) return new Set(['default']);
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean) as PersonalityId[];
  return ids.length > 0 ? new Set(ids) : new Set(['default']);
}

export default function PersonalityScreen() {
  const language = useSettingsStore((s) => s.language);
  const st = P_STRINGS[language] ?? P_STRINGS.en;

  const [selected, setSelected] = useState<Set<PersonalityId>>(new Set(['default']));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await profilesAPI.getMe();
        const data = res?.data as { leeloo_personality?: string } | undefined;
        if (mounted && data?.leeloo_personality) {
          setSelected(parseSelected(data.leeloo_personality));
        }
      } catch (e) {
        console.log('[personality] load failed', e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const toggle = (id: PersonalityId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size <= 1) return prev;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const value = Array.from(selected).join(',');
      await profilesAPI.updateMe({ leeloo_personality: value });
      router.back();
    } catch {
      Alert.alert('', st.errSave);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={['#FFF9F6', '#F0EDFF', '#E8E0FF']}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <WaveBackground opacity={0.06} cellSize={38} />

      <Stack.Screen
        options={{
          title: st.title,
          headerStyle: { backgroundColor: T.colors.cream },
          headerTintColor: T.colors.navy,
          headerTitleStyle: { fontFamily: T.fonts.bold, fontWeight: '700' },
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={{ paddingHorizontal: 8 }}>
              <Text style={{ fontSize: 22, color: T.colors.navy }}>✕</Text>
            </TouchableOpacity>
          ),
        }}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={T.colors.purple} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <LinearGradient
            colors={['#F07040', '#C4507A', '#8375FA']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.headerCard}
          >
            <WaveBackground opacity={0.12} cellSize={30} />
            <Text style={styles.headerTitle}>{st.title}</Text>
            <Text style={styles.headerSub}>{st.sub}</Text>
          </LinearGradient>

          <Text style={styles.multiNote}>{st.multiNote}</Text>

          <View style={styles.chipsGrid}>
            {PERSONALITY_IDS.map((p) => {
              const active = selected.has(p.id);
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => toggle(p.id)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.chipEmoji}>{p.emoji}</Text>
                  <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                    {LABELS[p.id]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {selected.size > 0 && (
            <View style={styles.selectedInfo}>
              <Text style={styles.selectedInfoTitle}>{st.activeLabel}</Text>
              {PERSONALITY_IDS.filter((p) => selected.has(p.id)).map((p) => (
                <Text key={p.id} style={styles.selectedInfoRow}>
                  {p.emoji} <Text style={{ fontWeight: '600' }}>{LABELS[p.id]}</Text>
                  {' '}— {st.descs[p.id]}
                </Text>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={['#8375FA', '#2D266C']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.saveBtnGradient}
            >
              {saving ? (
                <ActivityIndicator color={T.colors.white} />
              ) : (
                <Text style={styles.saveBtnText}>{st.save}</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, paddingBottom: 60 },
  headerCard: {
    borderRadius: T.radius.lg,
    padding: 24,
    marginBottom: 16,
    overflow: 'hidden',
    gap: 6,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    color: T.colors.white,
  },
  headerSub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.75)',
    fontFamily: T.fonts.regular,
  },
  multiNote: {
    fontSize: 13,
    color: '#8F8BB8',
    fontFamily: T.fonts.regular,
    textAlign: 'center',
    marginBottom: 16,
    fontStyle: 'italic',
  },
  chipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    marginBottom: 20,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: T.radius.full,
    backgroundColor: T.colors.white,
    borderWidth: 1.5,
    borderColor: '#E8E4F0',
    shadowColor: T.colors.navy,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  chipActive: {
    backgroundColor: T.colors.navy,
    borderColor: T.colors.navy,
  },
  chipEmoji: { fontSize: 16 },
  chipLabel: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: T.fonts.semiBold,
    color: T.colors.navy,
  },
  chipLabelActive: { color: T.colors.white },
  selectedInfo: {
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: T.radius.md,
    padding: 16,
    marginBottom: 20,
    gap: 6,
    borderWidth: 1,
    borderColor: '#EDE9F8',
  },
  selectedInfoTitle: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    color: T.colors.navy,
    marginBottom: 4,
  },
  selectedInfoRow: {
    fontSize: 13,
    color: '#4B4890',
    fontFamily: T.fonts.regular,
    lineHeight: 20,
  },
  saveBtn: {
    borderRadius: T.radius.md,
    overflow: 'hidden',
    shadowColor: T.colors.purple,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  saveBtnGradient: {
    paddingVertical: 15,
    alignItems: 'center',
  },
  saveBtnText: {
    color: T.colors.white,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
  },
});
