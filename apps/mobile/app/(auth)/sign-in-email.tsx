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
import { LinearGradient } from 'expo-linear-gradient';
import { WaveBackground } from '@/components/WaveBackground';
import { T } from '@/lib/theme';

type Step = 'email' | 'password' | 'verify' | 'register' | 'forgot' | 'reset_code' | 'new_password';

export default function SignInEmailScreen() {
  const router = useRouter();
  const { signIn, setActive: setActiveSignIn, isLoaded: signInLoaded } = useSignIn();
  const { signUp, setActive: setActiveSignUp, isLoaded: signUpLoaded } = useSignUp();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Sign in: step 1 — check if email exists ──────────────────────────────
  const handleEmailNext = async () => {
    if (!email.trim() || !signInLoaded) return;
    setError(null);
    setLoading(true);
    try {
      await signIn!.create({ identifier: email.trim() });
      setStep('password');
    } catch (e: any) {
      const errCode = e?.errors?.[0]?.code || '';
      if (errCode === 'form_identifier_not_found') {
        setStep('register');
      } else {
        setError('Verifica tu email e intenta de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ─── Sign in: step 2 — password ───────────────────────────────────────────
  const handleSignIn = async () => {
    if (!password.trim() || !signInLoaded) return;
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
      const errCode = e?.errors?.[0]?.code || '';
      if (errCode === 'form_password_incorrect') {
        setError('Contraseña incorrecta. Intenta de nuevo.');
      } else if (errCode === 'strategy_for_user_invalid') {
        setError('Esta cuenta usa Google o GitHub. Inicia sesión con esos botones.');
      } else {
        setError(e?.errors?.[0]?.message || 'No se pudo iniciar sesión.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ─── Sign up ──────────────────────────────────────────────────────────────
  const handleRegister = async () => {
    if (!name.trim()) {
      setError('Escribe tu nombre para continuar.');
      return;
    }
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (!signUpLoaded) return;
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

  // ─── Email verification ───────────────────────────────────────────────────
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
    } catch {
      setError('Código incorrecto. Revisa tu email.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Forgot password: step 1 — send reset code ────────────────────────────
  const handleForgotPassword = async () => {
    if (!email.trim() || !signInLoaded) return;
    setError(null);
    setLoading(true);
    try {
      await signIn!.create({
        strategy: 'reset_password_email_code',
        identifier: email.trim(),
      });
      setStep('reset_code');
    } catch (e: any) {
      setError(e?.errors?.[0]?.message || 'No se pudo enviar el código. Verifica tu email.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Forgot password: step 2 — verify reset code ─────────────────────────
  const handleResetCode = async () => {
    if (!resetCode.trim() || !signInLoaded) return;
    setError(null);
    setLoading(true);
    try {
      await signIn!.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code: resetCode.trim(),
      });
      setStep('new_password');
    } catch {
      setError('Código incorrecto. Revisa tu email.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Forgot password: step 3 — set new password ───────────────────────────
  const handleNewPassword = async () => {
    if (newPassword.length < 8 || !signInLoaded) return;
    setError(null);
    setLoading(true);
    try {
      const result = await (signIn! as any).resetPassword({ password: newPassword.trim() });
      if (result.status === 'complete') {
        await setActiveSignIn!({ session: result.createdSessionId });
        router.replace('/');
      }
    } catch (e: any) {
      setError(e?.errors?.[0]?.message || 'No se pudo cambiar la contraseña.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Step config ──────────────────────────────────────────────────────────
  const handlePrimary = () => {
    if (step === 'email') return handleEmailNext();
    if (step === 'password') return handleSignIn();
    if (step === 'register') return handleRegister();
    if (step === 'verify') return handleVerify();
    if (step === 'reset_code') return handleResetCode();
    if (step === 'new_password') return handleNewPassword();
  };

  const isPrimaryDisabled = () => {
    if (step === 'email') return !email.trim();
    if (step === 'password') return !password.trim();
    if (step === 'register') return false; // allow tap — validate on submit
    if (step === 'verify') return code.length < 6;
    if (step === 'forgot') return !email.trim();
    if (step === 'reset_code') return resetCode.length < 6;
    if (step === 'new_password') return newPassword.length < 8;
    return false;
  };

  const titles: Record<Step, string> = {
    email: 'Tu email',
    password: 'Bienvenida de vuelta',
    register: 'Crear cuenta',
    verify: 'Verifica tu email',
    forgot: 'Recuperar contraseña',
    reset_code: 'Código de recuperación',
    new_password: 'Nueva contraseña',
  };

  const subtitles: Record<Step, string> = {
    email: 'Ingresa tu email para continuar',
    password: `Contraseña para ${email}`,
    register: 'Completa tu registro en Leeloo',
    verify: `Enviamos un código a ${email}`,
    forgot: `Te enviamos un código a ${email}`,
    reset_code: `Ingresa el código que enviamos a ${email}`,
    new_password: 'Elige una nueva contraseña segura',
  };

  const stepEmoji: Record<Step, string> = {
    email: '📧',
    password: '🔐',
    register: '✨',
    verify: '📩',
    forgot: '🔑',
    reset_code: '📩',
    new_password: '🔐',
  };

  const primaryLabel: Record<Step, string> = {
    email: 'Continuar →',
    password: 'Iniciar sesión',
    register: 'Crear cuenta',
    verify: 'Verificar código',
    forgot: 'Enviar código',
    reset_code: 'Verificar',
    new_password: 'Cambiar contraseña',
  };

  return (
    <View style={{ flex: 1, backgroundColor: T.colors.cream }}>
      <WaveBackground opacity={0.055} cellSize={38} />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={s.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Back */}
            <TouchableOpacity
              style={s.back}
              onPress={() => {
                if (step === 'password' || step === 'register') setStep('email');
                else if (step === 'forgot' || step === 'reset_code' || step === 'new_password') setStep('password');
                else router.back();
              }}
            >
              <Text style={s.backText}>← Volver</Text>
            </TouchableOpacity>

            {/* Header card */}
            <LinearGradient
              colors={['#F07040', '#C4507A', '#8375FA']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.headerCard}
            >
              <WaveBackground opacity={0.12} cellSize={30} />
              <Text style={s.headerEmoji}>{stepEmoji[step]}</Text>
              <Text style={s.headerTitle}>{titles[step]}</Text>
              <Text style={s.headerSub}>{subtitles[step]}</Text>
            </LinearGradient>

            {/* Form card */}
            <View style={s.formCard}>
              {!!error && (
                <View style={s.errorBox}>
                  <Text style={s.errorText}>{error}</Text>
                </View>
              )}

              {step === 'email' && (
                <TextInput
                  style={s.input}
                  placeholder="correo@ejemplo.com"
                  placeholderTextColor={T.colors.muted}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoFocus
                  onSubmitEditing={handleEmailNext}
                  returnKeyType="next"
                />
              )}

              {step === 'password' && (
                <>
                  <TextInput
                    style={s.input}
                    placeholder="Contraseña"
                    placeholderTextColor={T.colors.muted}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoFocus
                    onSubmitEditing={handleSignIn}
                    returnKeyType="done"
                  />
                  <TouchableOpacity style={s.forgotBtn} onPress={handleForgotPassword} disabled={loading}>
                    <Text style={s.forgotText}>¿Olvidaste tu contraseña?</Text>
                  </TouchableOpacity>
                </>
              )}

              {step === 'register' && (
                <>
                  <TextInput
                    style={s.input}
                    placeholder="Tu nombre completo *"
                    placeholderTextColor={T.colors.muted}
                    value={name}
                    onChangeText={(v) => { setName(v); setError(null); }}
                    autoFocus
                    returnKeyType="next"
                  />
                  <TextInput
                    style={s.input}
                    placeholder="Contraseña (mínimo 8 caracteres) *"
                    placeholderTextColor={T.colors.muted}
                    value={password}
                    onChangeText={(v) => { setPassword(v); setError(null); }}
                    secureTextEntry
                    onSubmitEditing={handleRegister}
                    returnKeyType="done"
                  />
                </>
              )}

              {step === 'verify' && (
                <TextInput
                  style={[s.input, s.codeInput]}
                  placeholder="000000"
                  placeholderTextColor={T.colors.muted}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />
              )}

              {step === 'forgot' && (
                <TextInput
                  style={s.input}
                  placeholder="correo@ejemplo.com"
                  placeholderTextColor={T.colors.muted}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoFocus
                  onSubmitEditing={handleForgotPassword}
                  returnKeyType="done"
                />
              )}

              {step === 'reset_code' && (
                <TextInput
                  style={[s.input, s.codeInput]}
                  placeholder="000000"
                  placeholderTextColor={T.colors.muted}
                  value={resetCode}
                  onChangeText={setResetCode}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />
              )}

              {step === 'new_password' && (
                <TextInput
                  style={s.input}
                  placeholder="Nueva contraseña (mínimo 8 caracteres)"
                  placeholderTextColor={T.colors.muted}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry
                  autoFocus
                  onSubmitEditing={handleNewPassword}
                  returnKeyType="done"
                />
              )}

              {/* Primary button */}
              <TouchableOpacity
                style={[s.primaryBtn, (isPrimaryDisabled() || loading) && s.disabled]}
                onPress={handlePrimary}
                disabled={isPrimaryDisabled() || loading}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={['#8375FA', '#2D266C']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={s.primaryBtnGradient}
                >
                  {loading ? (
                    <ActivityIndicator color={T.colors.white} />
                  ) : (
                    <Text style={s.primaryBtnText}>{primaryLabel[step]}</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 60, gap: 16 },
  back: { marginBottom: 4 },
  backText: {
    color: T.colors.purple,
    fontSize: 15,
    fontFamily: T.fonts.semiBold,
    fontWeight: '600',
  },
  headerCard: {
    borderRadius: T.radius.lg,
    padding: 24,
    overflow: 'hidden',
    gap: 6,
  },
  headerEmoji: { fontSize: 32, marginBottom: 4 },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
    color: T.colors.white,
  },
  headerSub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    fontFamily: T.fonts.regular,
  },
  formCard: {
    backgroundColor: T.colors.white,
    borderRadius: T.radius.lg,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: '#EDE9F8',
    shadowColor: T.colors.navy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 4,
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    borderRadius: T.radius.sm,
    padding: 12,
  },
  errorText: {
    color: T.colors.error,
    fontSize: 13,
    fontFamily: T.fonts.regular,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#F8F6FF',
    borderRadius: T.radius.md,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: T.colors.navy,
    borderWidth: 1.5,
    borderColor: '#E8E4F0',
    fontFamily: T.fonts.regular,
  },
  codeInput: {
    textAlign: 'center',
    letterSpacing: 10,
    fontSize: 28,
    fontFamily: T.fonts.bold,
    fontWeight: '700',
  },
  forgotBtn: { alignItems: 'center' },
  forgotText: {
    color: T.colors.purple,
    fontSize: 13,
    fontFamily: T.fonts.semiBold,
    fontWeight: '600',
  },
  primaryBtn: {
    borderRadius: T.radius.md,
    overflow: 'hidden',
    shadowColor: T.colors.purple,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  primaryBtnGradient: {
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: T.colors.white,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: T.fonts.bold,
  },
  disabled: { opacity: 0.5 },
});
