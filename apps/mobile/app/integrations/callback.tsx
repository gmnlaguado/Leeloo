import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

/**
 * This screen is the deep-link target for leeloo://integrations/callback.
 * expo-web-browser.openAuthSessionAsync() detects the leeloo:// scheme and
 * closes the in-app browser, passing the URL back to the caller. This screen
 * is never actually rendered in practice — maybeCompleteAuthSession() handles
 * the handshake before React renders anything.
 */
export default function OAuthCallbackScreen() {
  useEffect(() => {
    WebBrowser.maybeCompleteAuthSession();
  }, []);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B0B14' }}>
      <ActivityIndicator color="#7C3AED" size="large" />
    </View>
  );
}
