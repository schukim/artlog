import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { AuthStackParamList } from "../../types/navigation";
import {
  signIn,
  signInWithGoogle,
  signInWithApple,
  resendConfirmation,
} from "../../services/auth";
import { useGuestStore } from "../../stores/guestStore";
import { authErrorMessageKey, classifyAuthError } from "../../utils/authErrors";

type Nav = NativeStackNavigationProp<AuthStackParamList, "Login">;

export function LoginScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 미인증 계정일 때만 '인증 메일 재전송'을 띄운다. 이전에는 재전송 버튼이 가입 직후
  // 화면(SignUpScreen step 3)에만 있어서, 앱을 한 번이라도 껐다 켠 미인증 사용자는
  // 앱 안에서 빠져나갈 방법이 전혀 없었다.
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const resumeGuest = useGuestStore((s) => s.resumeGuest);
  const cameFromGuest = useGuestStore((s) => s.cameFromGuest);
  const hasPendingReview = useGuestStore((s) => s.hasPendingReview);

  // 로그인은 형식만 확인 — 비밀번호 길이는 강제하지 않는다(가입 정책이 바뀌어도
  // 기존 계정이 버튼 비활성으로 잠기지 않게). 최종 검증은 서버가 한다.
  const isValid = email.includes("@") && password.length > 0;

  const handleLogin = async () => {
    if (!isValid) return;
    setLoading(true);
    setError(null);
    setNeedsConfirmation(false);
    try {
      await signIn(email, password);
    } catch (e: unknown) {
      // 서버 원문(`e.message`)을 그대로 뿌리면 "Invalid login credentials" 같은 영어가
      // 노출된다. 로그인 실패는 대부분 사용자가 스스로 풀어야 하는 상황이라
      // 무슨 일인지와 다음 행동이 한국어로 보여야 한다.
      const kind = classifyAuthError(e);
      setError(t(authErrorMessageKey(e)));
      setNeedsConfirmation(kind === "emailNotConfirmed");
    } finally {
      setLoading(false);
    }
  };

  // 미인증 안내에서 곧바로 인증 메일을 다시 보낸다. 입력돼 있는 이메일을 쓰므로
  // 사용자가 주소를 다시 칠 필요가 없다.
  const handleResendConfirmation = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await resendConfirmation(email.trim());
      Alert.alert(t("auth.resendEmailSuccessTitle"), t("auth.resendEmailSuccess"), [
        { text: t("common.confirm") },
      ]);
    } catch (e: unknown) {
      Alert.alert(t("auth.resendEmailFailedTitle"), t(authErrorMessageKey(e)), [
        { text: t("common.confirm") },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider: "google" | "apple") => {
    setLoading(true);
    setError(null);
    try {
      if (provider === "google") {
        await signInWithGoogle();
      } else {
        await signInWithApple();
      }
    } catch (e: unknown) {
      console.error(`${provider} login error:`, e);
      const providerName = provider === "google" ? "Google" : "Apple";
      const message =
        e instanceof Error && e.message
          ? e.message
          : t("auth.socialLoginFailed", { provider: providerName });
      setError(message);
      Alert.alert(
        t("auth.socialLoginErrorTitle", { provider: providerName }),
        message,
        [{ text: t("common.confirm") }]
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView testID="login-screen" className="flex-1 bg-surface">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="flex-1 justify-center px-6"
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo */}
          <View className="items-center mb-12">
            <Text className="text-primary text-4xl font-bold">{t("app.name")}</Text>
          </View>

          {/* 체험 평론 보관 중 경고 — 체험 평론은 새로 만든 계정으로만 옮겨진다.
              기존 계정으로 로그인하면 저장되지 않으므로 들어가기 전에 알려준다.
              (조용히 사라지는 것이 가장 나쁜 결과다) */}
          {hasPendingReview && (
            <View className="bg-surface-secondary border border-surface-tertiary rounded-2xl p-4 mb-6">
              <Text className="text-text text-[15px] font-semibold mb-1">
                {t("guest.pendingOnLoginTitle")}
              </Text>
              <Text className="text-text-secondary text-[13px] leading-5 mb-3">
                {t("guest.pendingOnLoginBody")}
              </Text>
              <Pressable onPress={() => navigation.navigate("SignUp")} hitSlop={6}>
                <Text className="text-primary text-[15px] font-semibold">
                  {t("guest.pendingOnLoginCta")}
                </Text>
              </Pressable>
            </View>
          )}

          {/* Email */}
          <View className="mb-4">
            <TextInput
              className="bg-surface-secondary border border-surface-tertiary rounded-xl px-4 py-3.5 text-text text-base"
              placeholder={t("auth.email")}
              placeholderTextColor="#9C9589"
              value={email}
              onChangeText={(text) => { setEmail(text); setError(null); setNeedsConfirmation(false); }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
          </View>

          {/* Password */}
          <View className="mb-2">
            <View className="relative">
              <TextInput
                className="bg-surface-secondary border border-surface-tertiary rounded-xl px-4 py-3.5 text-text text-base pr-16"
                placeholder={t("auth.password")}
                placeholderTextColor="#9C9589"
                value={password}
                onChangeText={(text) => { setPassword(text); setError(null); setNeedsConfirmation(false); }}
                secureTextEntry={!showPassword}
                autoComplete="password"
              />
              <Pressable
                className="absolute right-4 top-3.5"
                onPress={() => setShowPassword(!showPassword)}
              >
                <Text className="text-text-secondary text-[15px]">
                  {showPassword ? t("common.hide") : t("common.show")}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Error */}
          {error && (
            <Text className="text-error text-[15px] mb-4">{error}</Text>
          )}

          {/* 미인증 계정 — 앱 안에서 인증 메일을 다시 받을 수 있는 유일한 경로 */}
          {needsConfirmation && (
            <Pressable
              className={`border border-primary rounded-xl py-3.5 items-center mb-4 ${
                loading ? "opacity-50" : ""
              }`}
              onPress={handleResendConfirmation}
              disabled={loading}
            >
              <Text className="text-primary font-semibold text-base">
                {loading ? "..." : t("auth.resendEmail")}
              </Text>
            </Pressable>
          )}

          {/* Login Button */}
          <Pressable
            className={`rounded-xl py-4 items-center mb-4 ${
              isValid && !loading ? "bg-primary" : "bg-primary/40"
            }`}
            onPress={handleLogin}
            disabled={!isValid || loading}
          >
            <Text className="text-white font-semibold text-base">
              {loading ? "..." : t("auth.loginButton")}
            </Text>
          </Pressable>

          {/* 비밀번호 찾기 — 입력 중이던 이메일을 그대로 넘긴다 */}
          <View className="items-center mb-6">
            <Pressable
              onPress={() =>
                navigation.navigate("ForgotPassword", { email: email.trim() || undefined })
              }
              hitSlop={8}
            >
              <Text className="text-text-secondary text-[15px] font-medium">
                {t("auth.forgotPassword")}
              </Text>
            </Pressable>
          </View>

          {/* Divider */}
          <View className="flex-row items-center mb-6">
            <View className="flex-1 h-px bg-surface-tertiary" />
            <Text className="mx-4 text-text-tertiary text-[15px]">{t("auth.orDivider")}</Text>
            <View className="flex-1 h-px bg-surface-tertiary" />
          </View>

          {/* Social Login */}
          <Pressable
            className={`border border-surface-tertiary rounded-xl py-3.5 items-center ${
              Platform.OS === "ios" ? "mb-3" : "mb-8"
            }`}
            onPress={() => handleSocialLogin("google")}
            disabled={loading}
          >
            <Text className="text-text font-medium text-base">{t("auth.socialGoogle")}</Text>
          </Pressable>
          {Platform.OS === "ios" && (
            <Pressable
              className="border border-surface-tertiary rounded-xl py-3.5 items-center mb-8"
              onPress={() => handleSocialLogin("apple")}
              disabled={loading}
            >
              <Text className="text-text font-medium text-base">{t("auth.socialApple")}</Text>
            </Pressable>
          )}

          {/* Sign Up Link */}
          <View className="flex-row justify-center">
            <Text className="text-text-secondary text-[15px]">{t("auth.noAccount")} </Text>
            <Pressable onPress={() => navigation.navigate("SignUp")}>
              <Text className="text-primary text-[15px] font-semibold">{t("auth.signUp")}</Text>
            </Pressable>
          </View>

          {/* 체험 '복귀'만 열어둔다 — 둘러보던 중 로그인하러 온 사람이 돌아갈 길.
              여기서 체험을 새로 시작하는 입구는 두지 않는다: 로그인 화면에 오는 사람은
              계정 보유자이고, 체험은 계정이 없는 사람을 위한 회원가입 퍼널이기 때문이다.
              신규 진입로는 인트로 마지막 장에만 있다. */}
          {cameFromGuest && (
            <View className="items-center mt-6">
              <Pressable onPress={resumeGuest} hitSlop={8}>
                <Text className="text-text-secondary text-[15px] font-medium underline">
                  {t("guest.backToBrowse")}
                </Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
