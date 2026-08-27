import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useTasksStore } from '@/store/tasks';
import { TaskCard } from '@/components/TaskCard';
import { useSettingsStore } from '@/store/settings';

const DASH_STRINGS = {
  en: {
    title: 'Dashboard',
    tab_today: 'Today',
    tab_approvals: 'Approvals',
    tab_completed: 'Completed',
    empty: 'No tasks in this view.',
    badge_from: 'From',
  },
  es: {
    title: 'Dashboard',
    tab_today: 'Hoy',
    tab_approvals: 'Aprobaciones',
    tab_completed: 'Completadas',
    empty: 'No hay tareas en esta vista.',
    badge_from: 'De',
  },
  pt: {
    title: 'Dashboard',
    tab_today: 'Hoje',
    tab_approvals: 'Aprovações',
    tab_completed: 'Concluídas',
    empty: 'Nenhuma tarefa nesta visualização.',
    badge_from: 'De',
  },
  fr: {
    title: 'Tableau de bord',
    tab_today: "Aujourd'hui",
    tab_approvals: 'Approbations',
    tab_completed: 'Terminées',
    empty: 'Aucune tâche dans cette vue.',
    badge_from: 'De',
  },
} as const;

type TabKey = 'today' | 'approvals' | 'completed';

const getChildName = (task: { metadata?: Record<string, unknown> | null }) => {
  const meta = task.metadata ?? undefined;
  if (!meta) return undefined;
  const raw = meta.child_name;
  return typeof raw === 'string' && raw.trim() ? raw : undefined;
};

export default function DashboardScreen() {
  const hydrate = useTasksStore((s) => s.hydrate);
  const tasks = useTasksStore((s) => s.tasks);
  const params = useLocalSearchParams();
  const [tab, setTab] = useState<TabKey>('today');
  const language = useSettingsStore((s) => s.language);
  const d = DASH_STRINGS[language] ?? DASH_STRINGS.en;

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    const raw = typeof params?.tab === 'string' ? params.tab : '';
    if (raw === 'today' || raw === 'approvals' || raw === 'completed') {
      setTab(raw);
    }
  }, [params?.tab]);

  const today = useMemo(() => {
    const day = new Date().toLocaleDateString();
    return (tasks || []).filter((t) => {
      if (String(t.status || '') === 'done') return false;
      if (!t.due_at) return true;
      return new Date(t.due_at).toLocaleDateString() === day;
    });
  }, [tasks]);

  const approvals = useMemo(() => {
    return (tasks || []).filter((t) => String(t.status || '') === 'pending_approval');
  }, [tasks]);

  const completed = useMemo(() => {
    return (tasks || []).filter((t) => String(t.status || '') === 'done');
  }, [tasks]);

  const list = tab === 'today' ? today : tab === 'approvals' ? approvals : completed;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{d.title}</Text>
      </View>

      <View style={styles.tabs}>
        <Tab label={d.tab_today} active={tab === 'today'} onPress={() => setTab('today')} />
        <Tab
          label={`${d.tab_approvals}${approvals.length ? ` (${approvals.length})` : ''}`}
          active={tab === 'approvals'}
          onPress={() => setTab('approvals')}
        />
        <Tab
          label={`${d.tab_completed}${completed.length ? ` (${completed.length})` : ''}`}
          active={tab === 'completed'}
          onPress={() => setTab('completed')}
        />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        {list.length === 0 ? (
          <Text style={styles.empty}>{d.empty}</Text>
        ) : (
          <View style={{ paddingTop: 10 }}>
            {list.map((t) => {
              const childName = getChildName(t);
              return (
                <TaskCard
                  key={t.id}
                  task={t}
                  badgeText={childName ? `${d.badge_from}: ${childName}` : undefined}
                  onApprove={tab === 'approvals' ? () => {} : undefined}
                  onReject={tab === 'approvals' ? () => {} : undefined}
                  onEdit={tab === 'approvals' ? () => {} : undefined}
                />
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Tab(props: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.tab, props.active && styles.tabActive]}
      onPress={props.onPress}
      activeOpacity={0.85}
    >
      <Text style={[styles.tabText, props.active && styles.tabTextActive]}>{props.label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
  },
  header: {
    marginTop: 20,
    marginBottom: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: '#111827',
  },
  tabs: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  tab: {
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: '#8B5CF6',
    borderColor: '#8B5CF6',
  },
  tabText: {
    color: '#111827',
    fontWeight: '800',
    fontSize: 12,
  },
  tabTextActive: {
    color: '#fff',
  },
  empty: {
    marginTop: 30,
    color: '#6B7280',
  },
});
