import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { WaveBackground } from '@/components/WaveBackground';
import { T } from '@/lib/theme';
import { Plus } from 'lucide-react-native';
import { TaskList } from '@/components/TaskList';

export default function TasksScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: T.colors.cream }}>
      <WaveBackground opacity={0.055} cellSize={38} />
      <SafeAreaView style={{ flex: 1 }}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.eyebrow}>Mis pendientes</Text>
            <Text style={s.title}>My Tasks</Text>
          </View>
          <TouchableOpacity activeOpacity={0.8}>
            <LinearGradient
              colors={['#F07040', '#8375FA']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.addBtn}
            >
              <Plus size={22} color={T.colors.white} strokeWidth={2.5} />
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* Task list */}
        <View style={{ flex: 1, paddingHorizontal: 20 }}>
          <TaskList />
        </View>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  eyebrow: {
    fontSize: 12,
    color: T.colors.muted,
    fontFamily: T.fonts.regular,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 2,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    fontFamily: T.fonts.bold,
    color: T.colors.navy,
  },
  addBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: T.colors.orange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
});
