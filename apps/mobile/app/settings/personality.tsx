import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { profilesAPI } from '../../lib/api';

type PersonalityId =
  | 'default'
  | 'christian'
  | 'coach'
  | 'mentor'
  | 'business'
  | 'counselor'
  | 'faith';

type PersonalityCard = {
  id: PersonalityId;
  label: string;
  emoji: string;
  desc: string;
  preview: string;
};

const PERSONALITIES: PersonalityCard[] = [
  {
    id: 'default',
    label: 'Leeloo Clásica',
    emoji: '⭐',
    desc: 'Organizada, empática y proactiva',
    preview: 'Hoy tienes 3 cosas importantes. Empezamos con la más urgente, ¿te parece?',
  },
  {
    id: 'christian',
    label: 'Modo Cristiano',
    emoji: '✝️',
    desc: 'Fe, oración y versículos diarios',
    preview: '"Todo lo puedo en Cristo que me fortalece." Hoy tienes 3 prioridades. ¿Oramos antes?',
  },
  {
    id: 'coach',
    label: 'Coach Ejecutiva',
    emoji: '🎯',
    desc: 'Metas, disciplina y accountability',
    preview: 'Llevas 3 días con esta tarea. ¿Qué te está frenando para cerrarla hoy?',
  },
  {
    id: 'mentor',
    label: 'Mentora de Vida',
    emoji: '🌱',
    desc: 'Perspectiva, crecimiento y propósito',
    preview: 'Lo de hoy es una pieza pequeña de algo grande. Vamos paso a paso.',
  },
  {
    id: 'business',
    label: 'Modo Business',
    emoji: '💼',
    desc: 'Productividad máxima, cero distracciones',
    preview: 'Tu 1:1 es en 30 minutos. Agenda pendiente: 3 puntos. ¿Los repasamos?',
  },
  {
    id: 'counselor',
    label: 'Consejera',
    emoji: '💜',
    desc: 'Escucha profunda, espacio seguro',
    preview: 'Eso suena pesado. ¿Quieres contarme un poco más antes de actuar?',
  },
  {
    id: 'faith',
    label: 'Modo Fe',
    emoji: '🕊️',
    desc: 'Espiritualidad y propósito universal',
    preview: 'Cada tarea de hoy es un acto de servicio. Respira, y empezamos.',
  },
];

export default function PersonalityScreen() {
  const [selected, setSelected] = useState<PersonalityId>('default');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<PersonalityId | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await profilesAPI.getMe();
        const data = res?.data as { leeloo_personality?: PersonalityId } | undefined;
        if (mounted && data?.leeloo_personality) {
          setSelected(data.leeloo_personality);
        }
      } catch (e) {
        console.log('[personality] load failed', e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const handleSelect = async (id: PersonalityId) => {
    if (saving) return;
    setSaving(id);
    try {
      await profilesAPI.updateMe({ leeloo_personality: id });
      setSelected(id);
    } catch (e) {
      Alert.alert('No se pudo guardar', 'Intenta de nuevo en un momento.');
      console.log('[personality] save failed', e);
    } finally {
      setSaving(null);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Personalidad de Leeloo',
          headerBackTitle: 'Atrás',
        }}
      />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#7C3AED" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.title}>¿Quién quieres que sea Leeloo hoy?</Text>
          <Text style={styles.subtitle}>
            Puedes cambiar su personalidad cuando quieras. Ella se adapta a ti.
          </Text>

          {PERSONALITIES.map((p) => {
            const isActive = p.id === selected;
            const isSaving = saving === p.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => handleSelect(p.id)}
                style={[styles.card, isActive && styles.cardActive]}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.emoji}>{p.emoji}</Text>
                  <View style={styles.cardHeaderText}>
                    <Text style={styles.cardLabel}>{p.label}</Text>
                    <Text style={styles.cardDesc}>{p.desc}</Text>
                  </View>
                  {isSaving ? (
                    <ActivityIndicator color="#7C3AED" />
                  ) : isActive ? (
                    <View style={styles.activeBadge}>
                      <Text style={styles.activeBadgeText}>Activa</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.preview}>"{p.preview}"</Text>
              </Pressable>
            );
          })}

          <Pressable style={styles.doneButton} onPress={() => router.back()}>
            <Text style={styles.doneButtonText}>Listo</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0B14' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { padding: 20, paddingBottom: 60 },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: '#A1A1AA',
    fontSize: 14,
    marginBottom: 24,
  },
  card: {
    backgroundColor: '#17172A',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cardActive: {
    borderColor: '#7C3AED',
    backgroundColor: '#1E1735',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardHeaderText: { flex: 1, marginLeft: 12 },
  emoji: { fontSize: 28 },
  cardLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  cardDesc: { color: '#A1A1AA', fontSize: 13, marginTop: 2 },
  activeBadge: {
    backgroundColor: '#7C3AED',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  activeBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  preview: {
    color: '#D4D4D8',
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: 4,
    lineHeight: 18,
  },
  doneButton: {
    marginTop: 24,
    backgroundColor: '#7C3AED',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  doneButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
