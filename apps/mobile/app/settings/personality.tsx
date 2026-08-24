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

type PersonalityId =
  | 'default' | 'christian' | 'coach' | 'mentor'
  | 'business' | 'counselor' | 'faith' | 'motivation' | 'balanced' | 'nurturing';

const PERSONALITIES: { id: PersonalityId; label: string; emoji: string; desc: string }[] = [
  { id: 'faith',      label: 'Faith',       emoji: '🕊️', desc: 'Espiritualidad y propósito' },
  { id: 'business',   label: 'Business',    emoji: '💼', desc: 'Productividad máxima' },
  { id: 'counselor',  label: 'Counselor',   emoji: '💜', desc: 'Escucha profunda' },
  { id: 'balanced',   label: 'Balanced',    emoji: '⚖️', desc: 'Equilibrio integral' },
  { id: 'mentor',     label: 'Mentor',      emoji: '🌱', desc: 'Crecimiento y propósito' },
  { id: 'motivation', label: 'Motivation',  emoji: '🎯', desc: 'Metas y disciplina' },
  { id: 'nurturing',  label: 'Nurturing',   emoji: '🌸', desc: 'Calidez y apoyo' },
  { id: 'christian',  label: 'Christian',   emoji: '✝️', desc: 'Fe, oración y gracia' },
  { id: 'coach',      label: 'Coach',       emoji: '⚡', desc: 'Accountability' },
  { id: 'default',    label: 'Leeloo Clásica', emoji: '⭐', desc: 'Organizada y empática' },
];

function parseSelected(raw: string | undefined): Set<PersonalityId> {
  if (!raw) return new Set(['default']);
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean) as PersonalityId[];
  return ids.length > 0 ? new Set(ids) : new Set(['default']);
}

export default function PersonalityScreen() {
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
        if (next.size <= 1) return prev; // al menos una siempre activa
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
    } catch (e) {
      Alert.alert('No se pudo guardar', 'Intenta de nuevo en un momento.');
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
          title: 'Personalidad de Leeloo',
          headerStyle: { backgroundColor: T.colors.cream },
          headerTintColor: T.colors.navy,
          headerTitleStyle: { fontFamily: T.fonts.bold, fontWeight: '700' },
        }}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={T.colors.purple} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <LinearGradient
            colors={['#F07040', '#C4507A', '#8375FA']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.headerCard}
          >
            <WaveBackground opacity={0.12} cellSize={30} />
            <Text style={styles.headerTitle}>Choose my personality</Text>
            <Text style={styles.headerSub}>You can change this anytime.</Text>
          </LinearGradient>

          {/* Multi-select note */}
          <Text style={styles.multiNote}>Multiple selections allowed.</Text>

          {/* Chips grid */}
          <View style={styles.chipsGrid}>
            {PERSONALITIES.map((p) => {
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
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Selected descriptions */}
          {selected.size > 0 && (
            <View style={styles.selectedInfo}>
              <Text style={styles.selectedInfoTitle}>Personalidades activas:</Text>
              {PERSONALITIES.filter((p) => selected.has(p.id)).map((p) => (
                <Text key={p.id} style={styles.selectedInfoRow}>
                  {p.emoji} <Text style={{ fontWeight: '600' }}>{p.label}</Text>
                  {' '}— {p.desc}
                </Text>
              ))}
            </View>
          )}

          {/* Save button */}
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
                <Text style={styles.saveBtnText}>Guardar selección</Text>
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
