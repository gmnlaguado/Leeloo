import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '@/store/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function Index() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const setHasCompletedOnboarding = useAuthStore((s) => s.setHasCompletedOnboarding);

  useEffect(() => {
    if (!isLoaded) return;

    const navigate = async () => {
      if (!isSignedIn) {
        router.replace('/(auth)/sign-in');
        return;
      }

      // Check if onboarding was completed
      const done = await AsyncStorage.getItem('hasCompletedOnboarding');
      if (done !== 'true') {
        router.replace('/onboarding');
        return;
      }

      setHasCompletedOnboarding(true);
      router.replace('/(tabs)/home');
    };

    void navigate();
  }, [isLoaded, isSignedIn]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B0B14' }}>
      <ActivityIndicator size="large" color="#7C3AED" />
    </View>
  );
}
