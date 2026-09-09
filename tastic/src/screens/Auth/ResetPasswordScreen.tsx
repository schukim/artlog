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
import { useAuthStore } from "../../stores/authStore";
import { updatePassword, signOut } from "../../services/auth";
import { authErrorMessageKey } from "../../utils/authErrors";

/**
 * 비밀번호 재설정 메일의 링크로 들어왔을 때만 뜨는 화면.
 *
 * 여기 도달한 시점에는 이미 복구 세션이 만들어져 있다(useDeepLinkAuth). 세션이
 * 없다면 코드 교환이 실패한 것 — 링크가 만료됐거나, 요청한 기기가 아닌 곳(PC 메일)에서
 * 열린 경우다. PKCE code_verifier 는 요청한 기기에만 있어서 이 경우는 복구가 불가능하다.
 * 조용히 로그인 화면으로 돌려보내면 사용자는 "링크를 눌렀는데 아무 일도 없었다"만 겪으므로
 * 이유를 설명하고 다시 요청할 길을 연다.
 */
export function ResetPasswordScreen() {
  const { t } = useTranslation();
  const session = useAuthStore((s) => s.session);
  const setPasswordRecovery = useAuthStore((s) => s.setPasswordRecovery);

  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordValid = password.length >= 8;
  const passwordMatch = password === passwordConfirm;
  const isValid = passwordValid && passwordMatch;

  // 복구 흐름을 벗어난다. 세션이 있어도 로그아웃시켜 로그인 화면으로 되돌린다 —
  // 비밀번호를 바꾸지 않은 채 계정 안으로 들여보내는 건 사용자의 의도가 아니다.
  const leaveRecovery = async () => {
    try {
      if (session) await signOut();
    } catch (e) {
      console.error("reset password sign out failed:", e);
    } finally {
      setPasswordRecovery(false);
    }
  };

  const handleSubmit = async () => {
    if (!isValid || loading) return;
    setLoading(true);
    setError(null);
    try {
      await updatePassword(password);
      // 플래그를 내리면 라우터가 정상 경로(Main/온보딩)로 넘긴다. 복구 세션이
      // 그대로 로그인 상태이므로 다시 로그인할 필요는 없다.
      setPasswordRecovery(false);
      Alert.alert(t("auth.resetPassword.doneTitle"), t("auth.resetPassword.doneMessage"), [
        { text: t("common.confirm") },
      ]);
    } catch (e: unknown) {
      setError(t(authErrorMessageKey(e)));
    } finally {
      setLoading(false);
    }
  };

  if (!session) {
    return (
      <SafeAreaView className="flex-1 bg-surface">
        <View className="flex-1 justify-center px-6">
          <View className="items-center mb-8">
            <Text className="text-6xl mb-4">⏳</Text>
            <Text className="text-text text-lg font-semibold mb-2">
              {t("auth.resetPassword.expiredTitle")}
            </Text>
            <Text className="text-text-secondary text-center text-base leading-6">
              {t("auth.resetPassword.expiredMessage")}
            </Text>
          </View>
          <Pressable
            className="bg-primary rounded-xl py-4 items-center"
            onPress={leaveRecovery}
          >
            <Text className="text-white font-semibold text-base">
              {t("auth.resetPassword.retry")}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          className="flex-1 px-6"
          contentContainerClassName="flex-grow justify-center pb-8"
          keyboardShouldPersistTaps="handled"
        >
          <Text className="text-text text-2xl font-bold mb-2">
            {t("auth.resetPassword.newTitle")}
          </Text>
          <Text className="text-text-secondary text-base mb-8 leading-6">
            {t("auth.resetPassword.newSubtitle")}
          </Text>

          <View className="mb-4">
            <Text className="text-text-secondary text-[15px] mb-1.5">
              {t("auth.resetPassword.newPassword")}
            </Text>
            <View className="relative">
              <TextInput
                className="bg-surface-secondary border border-surface-tertiary rounded-xl px-4 py-3.5 text-text text-base pr-16"
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  setError(null);
                }}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoFocus
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
            {password.length > 0 && !passwordValid && (
              <Text className="text-error text-[13px] mt-1">{t("auth.passwordMinLength")}</Text>
            )}
          </View>

          <View className="mb-6">
            <Text className="text-text-secondary text-[15px] mb-1.5">
              {t("auth.passwordConfirm")}
            </Text>
            <TextInput
              className="bg-surface-secondary border border-surface-tertiary rounded-xl px-4 py-3.5 text-text text-base"
              value={passwordConfirm}
              onChangeText={(text) => {
                setPasswordConfirm(text);
                setError(null);
              }}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
            {passwordConfirm.length > 0 && !passwordMatch && (
              <Text className="text-error text-[13px] mt-1">
                {t("auth.resetPassword.mismatch")}
              </Text>
            )}
          </View>

          {error && <Text className="text-error text-[15px] mb-4">{error}</Text>}

          <Pressable
            className={`rounded-xl py-4 items-center mb-6 ${
              isValid && !loading ? "bg-primary" : "bg-primary/40"
            }`}
            onPress={handleSubmit}
            disabled={!isValid || loading}
          >
            <Text className="text-white font-semibold text-base">
              {loading ? "..." : t("auth.resetPassword.submit")}
            </Text>
          </Pressable>

          <View className="items-center">
            <Pressable onPress={leaveRecovery} hitSlop={8}>
              <Text className="text-text-secondary text-[15px] font-medium">
                {t("common.cancel")}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
