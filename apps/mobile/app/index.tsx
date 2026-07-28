import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth';

export default function Index() {
  const router = useRouter();
  const session = useAuthStore((state) => state.session);
  const hasCompletedOnboarding = useAuthStore((state) => state.hasCompletedOnboarding);

  useEffect(() => {
    // Navigation logic after auth check
    const timeout = setTimeout(() => {
      router.replace('/(tabs)/home');
    }, 1000);

    return () => clearTimeout(timeout);
  }, [router, session, hasCompletedOnboarding]);

  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#8B5CF6',
      }}
    >
      <ActivityIndicator size="large" color="#fff" />
    </View>
  );
}
