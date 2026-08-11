import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOAuth, useSignIn, useSignUp } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { startOAuthFlow: googleOAuth } = useOAuth({ strategy: 'oauth_google' });
  const { startOAuthFlow: appleOAuth } = useOAuth({ strategy: 'oauth_apple' });
  const { startOAuthFlow: githubOAuth } = useOAuth({ strategy: 'oauth_github' });

  const handleOAuth = async (
    provider: 'google' | 'apple' | 'github',
    startFlow: ReturnType<typeof useOAuth>['startOAuthFlow'],
  ) => {
    setError(null);
    setLoading(provider);
    try {
      const { createdSessionId, setActive } = await startFlow();
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        router.replace('/');
      }
    } catch (e: any) {
      setError('No se pudo iniciar sesión. Intenta de nuevo.');
      console.error(`[sign-in] ${provider} OAuth error`, e);
    } finally {
      setLoading(null);
    }
  };

  const handleEmail = () => {
    router.push('/(auth)/sign-in-email');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        {/* Logo / Avatar */}
        <View style={styles.logoContainer}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoEmoji}>🤖</Text>
          </View>
          <Text style={styles.appName}>Leeloo</Text>
          <Text style={styles.tagline}>Tu asistente personal inteligente</Text>
        </View>

        {/* Error */}
        {!!error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Botones de login */}
        <View style={styles.buttonsContainer}>
          <OAuthButton
            label="Continuar con Google"
            emoji="🔵"
            onPress={() => handleOAuth('google', googleOAuth)}
            loading={loading === 'google'}
            disabled={!!loading}
          />

          {Platform.OS === 'ios' && (
            <OAuthButton
              label="Continuar con Apple"
              emoji="🍎"
              onPress={() => handleOAuth('apple', appleOAuth)}
              loading={loading === 'apple'}
              disabled={!!loading}
              dark
            />
          )}

          <OAuthButton
            label="Continuar con GitHub"
            emoji="⚫"
            onPress={() => handleOAuth('github', githubOAuth)}
            loading={loading === 'github'}
            disabled={!!loading}
          />

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>o</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.emailButton, !!loading && styles.disabled]}
            onPress={handleEmail}
            disabled={!!loading}
          >
            <Text style={styles.emailButtonText}>📧  Continuar con Email</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.terms}>
          Al continuar aceptas nuestros{' '}
          <Text style={styles.link}>Términos de Servicio</Text> y{' '}
          <Text style={styles.link}>Política de Privacidad</Text>
        </Text>
      </View>
    </SafeAreaView>
  );
}

function OAuthButton({
  label,
  emoji,
  onPress,
  loading,
  disabled,
  dark,
}: {
  label: string;
  emoji: string;
  onPress: () => void;
  loading: boolean;
  disabled: boolean;
  dark?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.oauthButton, dark && styles.oauthButtonDark, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={dark ? '#fff' : '#374151'} size="small" />
      ) : (
        <>
          <Text style={styles.oauthEmoji}>{emoji}</Text>
          <Text style={[styles.oauthLabel, dark && styles.oauthLabelDark]}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0B14',
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingTop: 40,
    paddingBottom: 32,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 8,
  },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#1E1735',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#7C3AED',
  },
  logoEmoji: {
    fontSize: 48,
  },
  appName: {
    fontSize: 42,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -1,
  },
  tagline: {
    fontSize: 16,
    color: '#A1A1AA',
    marginTop: 8,
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: '#3B1219',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  errorText: {
    color: '#F87171',
    fontSize: 14,
    textAlign: 'center',
  },
  buttonsContainer: {
    gap: 12,
  },
  oauthButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 20,
    gap: 10,
    minHeight: 52,
  },
  oauthButtonDark: {
    backgroundColor: '#1C1C1E',
    borderWidth: 1,
    borderColor: '#3A3A3C',
  },
  oauthEmoji: {
    fontSize: 20,
  },
  oauthLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  oauthLabelDark: {
    color: '#FFFFFF',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#27272A',
  },
  dividerText: {
    color: '#71717A',
    fontSize: 14,
  },
  emailButton: {
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#3F3F46',
    alignItems: 'center',
    minHeight: 52,
  },
  emailButtonText: {
    color: '#E4E4E7',
    fontSize: 16,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
  terms: {
    fontSize: 12,
    color: '#71717A',
    textAlign: 'center',
    lineHeight: 18,
  },
  link: {
    color: '#7C3AED',
    textDecorationLine: 'underline',
  },
});
