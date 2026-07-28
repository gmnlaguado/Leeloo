import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { tasksAPI } from '@/lib/api';

export type Task = {
  id: string;
  title: string;
  description?: string | null;
  due_at?: string | null;
  status: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

type TasksState = {
  isHydrated: boolean;
  isLoading: boolean;
  error: string | null;
  tasks: Task[];
  hydrate: () => Promise<void>;
  upsert: (t: Task) => void;
  remove: (id: string) => void;
};

const upsertTask = (tasks: Task[], t: Task) => {
  const idx = tasks.findIndex((x) => x.id === t.id);
  if (idx === -1) return [t, ...tasks];
  const next = tasks.slice();
  next[idx] = { ...next[idx], ...t };
  return next;
};

export const useTasksStore = create<TasksState>((set, get) => ({
  isHydrated: false,
  isLoading: false,
  error: null,
  tasks: [],

  hydrate: async () => {
    if (get().isHydrated) return;

    set({ isLoading: true, error: null });

    try {
      const res = await tasksAPI.getTasks({ limit: 200 });
      const rows = Array.isArray(res.data) ? (res.data as Task[]) : [];
      set({ tasks: rows, isHydrated: true });

      const { data } = await supabase.auth.getSession();
      const uid = data?.session?.user?.id;
      if (!uid) return;

      const channel = supabase
        .channel(`tasks_realtime_${uid}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'tasks',
            filter: `user_id=eq.${uid}`,
          },
          (payload: unknown) => {
            const p = payload as {
              eventType?: unknown;
              new?: unknown;
              old?: unknown;
            };

            const type = typeof p?.eventType === 'string' ? p.eventType : '';
            const newRow = p?.new as { id?: unknown } | undefined;
            const oldRow = p?.old as { id?: unknown } | undefined;

            if (type === 'DELETE' && oldRow?.id) {
              get().remove(String(oldRow.id));
              return;
            }

            if ((type === 'INSERT' || type === 'UPDATE') && newRow?.id) {
              get().upsert(newRow as Task);
            }
          },
        )
        .subscribe();

      // Keep it on the singleton client; no explicit unsubscribe yet.
      void channel;
    } catch (e: unknown) {
      const msg = (e as { message?: unknown } | null)?.message;
      set({ error: typeof msg === 'string' ? msg : 'Failed to load tasks.' });
    } finally {
      set({ isLoading: false });
    }
  },

  upsert: (t) => set((s) => ({ tasks: upsertTask(s.tasks, t) })),
  remove: (id) => set((s) => ({ tasks: s.tasks.filter((t) => String(t.id) !== String(id)) })),
}));
