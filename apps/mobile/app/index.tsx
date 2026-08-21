import { useEffect, useState, useCallback } from 'react';
import { View, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '@/store/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deviceLogger } from '@/services/device-logger';

export default function Index() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const setHasCompletedOnboarding = useAuthStore((s) => s.setHasCompletedOnboarding);
  const [timedOut, setTimedOut] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [startTs] = useState(() => Date.now());

  const retry = useCallback(() => {
    setTimedOut(false);
    setRetryKey((k) => k + 1);
    deviceLogger.log('Index: retry pressed');
  }, []);

  // Log isLoaded transitions
  useEffect(() => {
    deviceLogger.log('Index: isLoaded changed', { isLoaded, isSignedIn, elapsedMs: Date.now() - startTs });
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (isLoaded) return;
    deviceLogger.log('Index: waiting for Clerk isLoaded=true, timeout=20s');
    const t = setTimeout(() => {
      deviceLogger.error('Index: Clerk isLoaded timeout after 20s — showing error screen', {
        isLoaded, isSignedIn, elapsedMs: Date.now() - startTs,
      });
      void deviceLogger.flush();
      setTimedOut(true);
    }, 20000);
    return () => clearTimeout(t);
  }, [isLoaded, retryKey]);

  useEffect(() => {
    if (!isLoaded) return;

    const navigate = async () => {
      if (!isSignedIn) {
        router.replace('/(auth)/sign-in');
        return;
      }

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
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#0B0B14',
          padding: 32,
        }}
      >
        <Text style={{ color: '#EF4444', fontSize: 16, textAlign: 'center', marginBottom: 8 }}>
          No se pudo conectar con el servidor de autenticación.
        </Text>
        <Text style={{ color: '#6B7280', fontSize: 13, textAlign: 'center', marginBottom: 24 }}>
          Verifica tu conexión a internet y vuelve a intentarlo.
        </Text>
        <TouchableOpacity
          onPress={retry}
          style={{
            backgroundColor: '#7C3AED',
            paddingHorizontal: 28,
            paddingVertical: 12,
            borderRadius: 10,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#0B0B14',
      }}
    >
      <ActivityIndicator size="large" color="#7C3AED" />
    </View>
  );
}
