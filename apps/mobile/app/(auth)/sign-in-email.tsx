import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSignIn, useSignUp } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { useState } from 'react';

type Step = 'email' | 'password' | 'verify' | 'register';

export default function SignInEmailScreen() {
  const router = useRouter();
  const { signIn, setActive: setActiveSignIn, isLoaded: signInLoaded } = useSignIn();
  const { signUp, setActive: setActiveSignUp, isLoaded: signUpLoaded } = useSignUp();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);

  const handleEmailNext = async () => {
    if (!email.trim()) return;
    setError(null);
    setLoading(true);
    try {
      // Try to find if user exists
      const res = await signIn!.create({ identifier: email.trim() });
      setIsNewUser(false);
      setStep('password');
    } catch (e: any) {
      const code = e?.errors?.[0]?.code || '';
      if (code === 'form_identifier_not_found') {
        setIsNewUser(true);
        setStep('register');
      } else {
        setError('Verifica tu email e intenta de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async () => {
    if (!password.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const result = await signIn!.create({
        identifier: email.trim(),
        password: password.trim(),
      });
      if (result.status === 'complete') {
        await setActiveSignIn!({ session: result.createdSessionId });
        router.replace('/');
      }
    } catch (e: any) {
      setError('Contraseña incorrecta. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!password.trim() || !name.trim()) return;
    setError(null);
    setLoading(true);
    try {
      await signUp!.create({
        emailAddress: email.trim(),
        password: password.trim(),
        firstName: name.trim().split(' ')[0],
        lastName: name.trim().split(' ').slice(1).join(' ') || undefined,
      });
      await signUp!.prepareEmailAddressVerification({ strategy: 'email_code' });
      setStep('verify');
    } catch (e: any) {
      const msg = e?.errors?.[0]?.message || 'No se pudo crear la cuenta.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!code.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const result = await signUp!.attemptEmailAddressVerification({ code: code.trim() });
      if (result.status === 'complete') {
        await setActiveSignUp!({ session: result.createdSessionId });
        router.replace('/');
      }
    } catch (e: any) {
      setError('Código incorrecto. Revisa tu email.');
    } finally {
      setLoading(false);
    }
  };

  const titles: Record<Step, string> = {
    email: 'Tu email',
    password: 'Bienvenida de vuelta',
    register: 'Crear cuenta',
    verify: 'Verifica tu email',
  };

  const subtitles: Record<Step, string> = {
    email: 'Ingresa tu email para continuar',
    password: `Ingresa tu contraseña para ${email}`,
    register: 'Completa tu registro en Leeloo',
    verify: `Enviamos un código a ${email}`,
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <Text style={styles.backText}>← Volver</Text>
          </TouchableOpacity>

          <Text style={styles.title}>{titles[step]}</Text>
          <Text style={styles.subtitle}>{subtitles[step]}</Text>

          {!!error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {step === 'email' && (
            <>
              <TextInput
                style={styles.input}
                placeholder="correo@ejemplo.com"
                placeholderTextColor="#71717A"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                autoFocus
              />
              <PrimaryButton
                label="Continuar"
                onPress={handleEmailNext}
                loading={loading}
                disabled={!email.trim()}
              />
            </>
          )}

          {step === 'password' && (
            <>
              <TextInput
                style={styles.input}
                placeholder="Contraseña"
                placeholderTextColor="#71717A"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoFocus
              />
              <PrimaryButton
                label="Iniciar sesión"
                onPress={handleSignIn}
                loading={loading}
                disabled={!password.trim()}
              />
              <TouchableOpacity style={styles.forgotBtn}>
                <Text style={styles.forgotText}>¿Olvidaste tu contraseña?</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'register' && (
            <>
              <TextInput
                style={styles.input}
                placeholder="Tu nombre completo"
                placeholderTextColor="#71717A"
                value={name}
                onChangeText={setName}
                autoFocus
              />
              <TextInput
                style={styles.input}
                placeholder="Contraseña (mínimo 8 caracteres)"
                placeholderTextColor="#71717A"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
              <PrimaryButton
                label="Crear cuenta"
                onPress={handleRegister}
                loading={loading}
                disabled={!name.trim() || password.length < 8}
              />
            </>
          )}

          {step === 'verify' && (
            <>
              <TextInput
                style={[styles.input, styles.codeInput]}
                placeholder="Código de 6 dígitos"
                placeholderTextColor="#71717A"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
              />
              <PrimaryButton
                label="Verificar"
                onPress={handleVerify}
                loading={loading}
                disabled={code.length < 6}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
}: {
  label: string;
  onPress: () => void;
  loading: boolean;
  disabled: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.primaryBtn, (disabled || loading) && styles.disabled]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.primaryBtnText}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0B14' },
  inner: { padding: 24, paddingTop: 16, gap: 16 },
  back: { marginBottom: 8 },
  backText: { color: '#7C3AED', fontSize: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#FFFFFF' },
  subtitle: { fontSize: 15, color: '#A1A1AA', marginBottom: 8 },
  errorBox: { backgroundColor: '#3B1219', borderRadius: 12, padding: 12 },
  errorText: { color: '#F87171', fontSize: 14 },
  input: {
    backgroundColor: '#17172A',
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#3F3F46',
  },
  codeInput: { textAlign: 'center', letterSpacing: 8, fontSize: 24 },
  primaryBtn: {
    backgroundColor: '#7C3AED',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  forgotBtn: { alignItems: 'center', paddingVertical: 8 },
  forgotText: { color: '#7C3AED', fontSize: 14 },
});
