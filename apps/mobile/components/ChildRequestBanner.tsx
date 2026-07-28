import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';

export function ChildRequestBanner(props: { count: number; onPress?: () => void }) {
  if (!props.count) return null;

  return (
    <TouchableOpacity style={styles.banner} onPress={props.onPress} activeOpacity={0.85}>
      <View style={styles.dot} />
      <Text style={styles.text}>{props.count} solicitudes pendientes de aprobación</Text>
      <Text style={styles.cta}>Abrir</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginTop: 16,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EF4444',
  },
  text: {
    flex: 1,
    color: '#7F1D1D',
    fontWeight: '800',
  },
  cta: {
    color: '#991B1B',
    fontWeight: '900',
  },
});
