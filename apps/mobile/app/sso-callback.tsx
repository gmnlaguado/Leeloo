import * as WebBrowser from 'expo-web-browser';
import { View, ActivityIndicator } from 'react-native';

// Must run at module level in the screen the OAuth redirect targets.
// Signals expo-web-browser that the auth session is complete so
// the startOAuthFlow promise in sign-in.tsx resolves instead of hanging.
WebBrowser.maybeCompleteAuthSession();

export default function SSOCallback() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F0EDFF' }}>
      <ActivityIndicator size="large" color="#8B5CF6" />
    </View>
  );
}
