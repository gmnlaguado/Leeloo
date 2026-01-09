import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Heart } from 'lucide-react-native';

const messages = [
  {
    text: 'Recuerda que Dios te fortalece en cada paso.',
    verse: 'Filipenses 4:13',
  },
  {
    text: 'Eres más fuerte de lo que piensas.',
    verse: 'Isaías 41:10',
  },
  {
    text: 'Cada día es una nueva oportunidad.',
    verse: 'Lamentaciones 3:22-23',
  },
  {
    text: 'Tu trabajo importa y hace la diferencia.',
    verse: 'Colosenses 3:23',
  },
];

export function MotivationalCard() {
  // In production, this would be personalized and rotated daily
  const todayMessage = messages[0];

  return (
    <LinearGradient
      colors={['#8B5CF6', '#7C3AED', '#6D28D9']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <View style={styles.iconContainer}>
        <Heart size={24} color="#fff" fill="#fff" />
      </View>
      <Text style={styles.message}>{todayMessage.text}</Text>
      <Text style={styles.verse}>{todayMessage.verse}</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 24,
    borderRadius: 16,
    marginVertical: 20,
  },
  iconContainer: {
    marginBottom: 12,
  },
  message: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
    lineHeight: 24,
  },
  verse: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    fontStyle: 'italic',
  },
});
