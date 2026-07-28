import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { Check, Circle } from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tasksAPI } from '@/lib/api';

interface TaskListProps {
  limit?: number;
}

export function TaskList({ limit }: TaskListProps) {
  const queryClient = useQueryClient();

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['tasks', { limit }],
    queryFn: async () => {
      const response = await tasksAPI.getTasks({ limit, status: 'pending' });
      return response.data;
    },
  });

  const toggleTaskMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const newStatus = status === 'pending' ? 'done' : 'pending';
      return tasksAPI.updateTask(id, { status: newStatus });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <Text>Loading tasks...</Text>
      </View>
    );
  }

  if (!tasks || tasks.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No tasks yet!</Text>
        <Text style={styles.emptySubtext}>Try saying "Hey Leeloo, add a task"</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={tasks}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.taskItem}
          onPress={() => toggleTaskMutation.mutate({ id: item.id, status: item.status })}
        >
          <View style={styles.taskCheckbox}>
            {item.status === 'done' ? (
              <Check size={20} color="#8B5CF6" />
            ) : (
              <Circle size={20} color="#D1D5DB" />
            )}
          </View>
          <View style={styles.taskContent}>
            <Text style={[styles.taskTitle, item.status === 'done' && styles.taskTitleDone]}>
              {item.title}
            </Text>
            {item.description && <Text style={styles.taskDescription}>{item.description}</Text>}
            {item.due_at && (
              <Text style={styles.taskDue}>Due: {new Date(item.due_at).toLocaleDateString()}</Text>
            )}
          </View>
        </TouchableOpacity>
      )}
      scrollEnabled={!limit}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    padding: 20,
    alignItems: 'center',
  },
  empty: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  taskItem: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  taskCheckbox: {
    marginRight: 12,
    paddingTop: 2,
  },
  taskContent: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1F2937',
    marginBottom: 4,
  },
  taskTitleDone: {
    textDecorationLine: 'line-through',
    color: '#9CA3AF',
  },
  taskDescription: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 4,
  },
  taskDue: {
    fontSize: 12,
    color: '#8B5CF6',
  },
});
