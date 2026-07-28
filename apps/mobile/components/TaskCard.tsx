import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Mail, Calendar, ShoppingCart, MessageSquare } from 'lucide-react-native';
import { Task } from '@/store/tasks';

const iconForSource = (source?: string) => {
  const s = String(source || '').toLowerCase();
  if (s.includes('gmail') || s.includes('email')) return Mail;
  if (s.includes('calendar')) return Calendar;
  if (
    s.includes('instacart') ||
    s.includes('walmart') ||
    s.includes('amazon') ||
    s.includes('cart')
  )
    return ShoppingCart;
  return MessageSquare;
};

export function TaskCard(props: {
  task: Task;
  onApprove?: () => void;
  onReject?: () => void;
  onEdit?: () => void;
  badgeText?: string;
}) {
  const { task } = props;
  const meta = (task.metadata ?? undefined) as Record<string, unknown> | undefined;
  const source = typeof meta?.source === 'string' ? meta.source : undefined;
  const Icon = iconForSource(source);

  return (
    <View style={styles.card}>
      <View style={styles.rowTop}>
        <View style={styles.left}>
          <View style={styles.iconWrap}>
            <Icon size={18} color="#8B5CF6" />
          </View>
          <View style={styles.textWrap}>
            {!!props.badgeText && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{props.badgeText}</Text>
              </View>
            )}
            <Text style={styles.title}>{task.title}</Text>
            {!!task.due_at && (
              <Text style={styles.meta}>📅 {new Date(task.due_at).toLocaleString()}</Text>
            )}
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.rejectBtn]}
          onPress={props.onReject}
          disabled={!props.onReject}
        >
          <Text style={styles.rejectText}>Rechazar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.editBtn]}
          onPress={props.onEdit}
          disabled={!props.onEdit}
        >
          <Text style={styles.editText}>Editar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.approveBtn]}
          onPress={props.onApprove}
          disabled={!props.onApprove}
        >
          <Text style={styles.approveText}>Aprobar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 10,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  left: {
    flexDirection: 'row',
    gap: 10,
    flex: 1,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    marginBottom: 6,
  },
  badgeText: {
    color: '#4338CA',
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  meta: {
    marginTop: 4,
    fontSize: 12,
    color: '#6B7280',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  rejectBtn: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
  },
  editBtn: {
    backgroundColor: '#F9FAFB',
    borderColor: '#E5E7EB',
  },
  approveBtn: {
    backgroundColor: '#ECFDF5',
    borderColor: '#6EE7B7',
  },
  rejectText: {
    color: '#B91C1C',
    fontWeight: '800',
  },
  editText: {
    color: '#111827',
    fontWeight: '800',
  },
  approveText: {
    color: '#065F46',
    fontWeight: '800',
  },
});
