import { useEffect, useState } from 'react';
import { View, ActivityIndicator, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '@/store/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function Index() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const setHasCompletedOnboarding = useAuthStore((s) => s.setHasCompletedOnboarding);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { if (!isLoaded) setTimedOut(true); }, 10000);
    return () => clearTimeout(t);
  }, [isLoaded]);

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

  if (timedOut) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B0B14', padding: 32 }}>
        <Text style={{ color: '#EF4444', fontSize: 16, textAlign: 'center', marginBottom: 8 }}>
          No se pudo conectar con el servidor de autenticación.
        </Text>
        <Text style={{ color: '#6B7280', fontSize: 13, textAlign: 'center' }}>
          Verifica tu conexión a internet y vuelve a abrir la app.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B0B14' }}>
      <ActivityIndicator size="large" color="#7C3AED" />
    </View>
  );
}
