import { Animated, StyleSheet, View } from 'react-native';
import { useEffect, useRef } from 'react';

export function LeelooAvatar(props: { active: boolean; size?: number }) {
  const size = props.size ?? 54;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!props.active) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }

    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      ]),
    );

    anim.start();
    return () => anim.stop();
  }, [props.active, pulse]);

  return (
    <Animated.View style={{ transform: [{ scale: pulse }] }}>
      <View
        style={[
          styles.avatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
          },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: '#8B5CF6',
    borderWidth: 4,
    borderColor: '#EDE9FE',
  },
});
