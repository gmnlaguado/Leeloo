import { useEffect, useState, useCallback } from 'react';
import { View, ActivityIndicator, Text, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '@/store/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function runNetworkDiag() {
  const lines: string[] = [];

  // 1. Clerk /v1/environment (first SDK call)
  try {
    const r = await fetchWithTimeout('https://clerk.leeloo.us/v1/environment');
    const body = await r.text();
    lines.push(`clerk /v1/environment → ${r.status}`);
    lines.push(body.slice(0, 200));
  } catch (e) {
    lines.push(`clerk /v1/environment → ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Clerk /v1/client (second SDK call)
  try {
    const r = await fetchWithTimeout('https://clerk.leeloo.us/v1/client');
    const body = await r.text();
    lines.push(`\nclerk /v1/client → ${r.status}`);
    lines.push(body.slice(0, 200));
  } catch (e) {
    lines.push(`\nclerk /v1/client → ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }

  Alert.alert('Diagnóstico Clerk', lines.join('\n'), [{ text: 'OK' }]);
}

export default function Index() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const setHasCompletedOnboarding = useAuthStore((s) => s.setHasCompletedOnboarding);
  const [timedOut, setTimedOut] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [elapsed, setElapsed] = useState(0);

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
