import { useEffect, useState, useCallback } from 'react';
import { View, ActivityIndicator, Text, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '@/store/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ENDPOINTS = [
  'https://clerk.leeloo.us/v1/client',
  'https://www.google.com',
  'https://leeloo-api-55i5.onrender.com/health',
];

async function runNetworkDiag() {
  const results: string[] = [];
  for (const url of ENDPOINTS) {
    try {
      const res = await Promise.race([
        fetch(url, { method: 'GET' }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout 8s')), 8000),
        ),
      ]);
      results.push(`✅ ${url.split('/')[2]} → ${(res as Response).status}`);
    } catch (e: any) {
      results.push(`❌ ${url.split('/')[2]} → ${e?.message ?? e}`);
    }
  }
  Alert.alert('Diagnóstico de red', results.join('\n\n'), [{ text: 'OK' }]);
}

export default function Index() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const setHasCompletedOnboarding = useAuthStore((s) => s.setHasCompletedOnboarding);
  const [timedOut, setTimedOut] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // Run network diagnostic 2 seconds after mount so user can see it
  useEffect(() => {
    const t = setTimeout(() => { void runNetworkDiag(); }, 2000);
    return () => clearTimeout(t);
  }, []);

  const retry = useCallback(() => {
    setTimedOut(false);
    setElapsed(0);
    setRetryKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (isLoaded) return;
    setElapsed(0);
    const ticker = setInterval(() => setElapsed((s) => s + 1), 1000);
    const t = setTimeout(() => {
      clearInterval(ticker);
      setTimedOut(true);
    }, 60000);
    return () => {
      clearTimeout(t);
      clearInterval(ticker);
    };
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
          onPress={() => { void runNetworkDiag(); retry(); }}
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
      <Text style={{ color: '#6B7280', fontSize: 11, marginTop: 12 }}>{elapsed}s</Text>
    </View>
  );
}
