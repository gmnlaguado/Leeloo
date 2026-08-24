import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useOAuth } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { WaveBackground } from '@/components/WaveBackground';
import { T } from '@/lib/theme';

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
      const redirectUrl = Linking.createURL('/');
      const { createdSessionId, setActive } = await startFlow({ redirectUrl });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        router.replace('/');
      }
    } catch (e: any) {
      console.log('[oauth] error', e?.message ?? e);
      setError('No se pudo iniciar sesión. Intenta de nuevo.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={['#FFF9F6', '#F0EDFF', '#E8E0FF']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <WaveBackground opacity={0.06} cellSize={38} />

      <SafeAreaView style={styles.safe}>
        {/* Logo */}
        <View style={styles.logoArea}>
          <View style={styles.logoCircle}>
            <Image
              source={require('../../assets/icon.png')}
              style={styles.logoImage}
              resizeMode="cover"
            />
          </View>
          <Text style={styles.appName}>Leeloo</Text>
          <Text style={styles.tagline}>The element that holds it all together.</Text>
        </View>

        {/* Card */}
        <View style={styles.card}>
          <Text style={styles.welcomeTitle}>Welcome</Text>

          {!!error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Email login */}
          <TouchableOpacity
            style={[styles.loginBtn, !!loading && styles.disabled]}
            onPress={() => router.push('/(auth)/sign-in-email')}
            disabled={!!loading}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={['#FFB59E', '#F07040']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.loginBtnGradient}
            >
              <Text style={styles.loginBtnText}>Login  →</Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>- OR Continue with -</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Social buttons */}
          <View style={styles.socialRow}>
            <SocialBtn
              label="G"
              color="#DB4437"
              onPress={() => handleOAuth('google', googleOAuth)}
              loading={loading === 'google'}
              disabled={!!loading}
            />
            {Platform.OS === 'ios' && (
              <SocialBtn
                label="🍎"
                color={T.colors.black}
                onPress={() => handleOAuth('apple', appleOAuth)}
                loading={loading === 'apple'}
                disabled={!!loading}
                emoji
              />
            )}
            <SocialBtn
              label="⬛"
              color={T.colors.navy}
              onPress={() => handleOAuth('github', githubOAuth)}
              loading={loading === 'github'}
              disabled={!!loading}
              emoji
            />
          </View>

          {/* Sign up link */}
          <TouchableOpacity
            onPress={() => router.push('/(auth)/sign-in-email')}
            disabled={!!loading}
            style={styles.signupRow}
          >
            <Text style={styles.signupText}>
              Create An Account{' '}
              <Text style={styles.signupLink}>Sign Up</Text>
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.terms}>
          By continuing, you agree to Leeloo's{' '}
          <Text style={styles.termsLink}>Terms & Conditions.</Text>
        </Text>
      </SafeAreaView>
    </View>
  );
}

function SocialBtn({
  label, color, onPress, loading, disabled, emoji,
}: {
  label: string; color: string; onPress: () => void;
  loading: boolean; disabled: boolean; emoji?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.socialBtn, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={color} size="small" />
      ) : (
        <Text style={[styles.socialBtnText, emoji && { fontSize: 22 }, { color }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  logoArea: {
    alignItems: 'center',
    gap: 10,
    marginTop: 24,
  },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 28,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 10,
  },
  logoImage: {
    width: 100,
    height: 100,
    borderRadius: 28,
  },
  appName: {
    fontSize: 36,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    color: T.colors.navy,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 13,
    color: '#8F8BB8',
    fontStyle: 'italic',
    fontFamily: T.fonts.regular,
  },
  card: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 24,
    padding: 28,
    gap: 16,
    shadowColor: T.colors.navy,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 8,
  },
  welcomeTitle: {
    fontSize: 28,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    color: T.colors.navy,
    marginBottom: 4,
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    padding: 10,
  },
  errorText: {
    color: T.colors.error,
    fontSize: 13,
    textAlign: 'center',
  },
  loginBtn: {
    borderRadius: T.radius.md,
    overflow: 'hidden',
    shadowColor: T.colors.orange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  loginBtnGradient: {
    paddingVertical: 15,
    alignItems: 'center',
  },
  loginBtnText: {
    color: T.colors.white,
    fontSize: 17,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    letterSpacing: 0.3,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E8E4F0',
  },
  dividerText: {
    fontSize: 12,
    color: '#9CA3AF',
    fontFamily: T.fonts.regular,
  },
  socialRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  socialBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: T.colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#E8E4F0',
    shadowColor: T.colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  socialBtnText: {
    fontSize: 18,
    fontWeight: '700',
  },
  signupRow: {
    alignItems: 'center',
    paddingTop: 4,
  },
  signupText: {
    fontSize: 14,
    color: '#6B7280',
    fontFamily: T.fonts.regular,
  },
  signupLink: {
    color: T.colors.purple,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    textDecorationLine: 'underline',
  },
  terms: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 18,
    fontFamily: T.fonts.regular,
  },
  termsLink: {
    color: T.colors.purple,
  },
  disabled: { opacity: 0.5 },
});
