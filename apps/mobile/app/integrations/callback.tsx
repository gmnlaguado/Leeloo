import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';

// Module-level call — must run synchronously before React renders,
// otherwise openAuthSessionAsync on Android misses the handshake signal.
WebBrowser.maybeCompleteAuthSession();

export default function OAuthCallbackScreen() {
  const router = useRouter();

  useEffect(() => {
    // On Android, expo-router sometimes handles the deep link independently
    // of openAuthSessionAsync. Navigate back so the user isn't stuck here.
    const t = setTimeout(() => {
      router.replace('/settings/integrations');
    }, 600);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B0B14' }}>
      <ActivityIndicator color="#7C3AED" size="large" />
    </View>
  );
}
