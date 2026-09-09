import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { AuthStackParamList } from "../../types/navigation";
import { requestPasswordReset } from "../../services/auth";
import { authErrorMessageKey, classifyAuthError } from "../../utils/authErrors";

type Nav = NativeStackNavigationProp<AuthStackParamList, "ForgotPassword">;
type Route = RouteProp<AuthStackParamList, "ForgotPassword">;

export function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();

  const [email, setEmail] = useState(route.params?.email ?? "");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValid = email.includes("@") && email.includes(".");

  const handleSend = async () => {
    if (!isValid || loading) return;
    setLoading(true);
    setError(null);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (e: unknown) {
      // 발송 횟수 제한은 사용자가 대응할 수 있는 정보라 문구를 구분해 보여준다.
      // 그 외에는 계정 존재 여부가 드러나지 않는 일반 문구로 통일한다.
      const kind = classifyAuthError(e);
      setError(kind === "unknown" ? t("auth.resetPassword.sendFailed") : t(authErrorMessageKey(e)));
    } finally {
      setLoading(false);
    }
  };

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
          {sent ? (
            <>
              {/* 발송 이후 — 메일이 실제로 갔는지와 무관하게 같은 화면을 보여준다
                  (계정 열거 방지). 대신 '이 휴대폰에서 열어야 한다'는 제약은
                  반드시 알린다 — PKCE 라 다른 기기에서 열면 링크가 통하지 않는다. */}
              <View className="items-center mb-8">
                <Text className="text-6xl mb-4">📬</Text>
                <Text className="text-text text-lg font-semibold mb-2">
                  {t("auth.resetPassword.sentTitle")}
                </Text>
                <Text className="text-text-secondary text-center text-base mb-4">
                  {t("auth.resetPassword.sentMessage", { email: email.trim() })}
                </Text>
                <View className="bg-surface-secondary rounded-xl p-4">
                  <Text className="text-text-secondary text-[15px] text-center leading-6">
                    {t("auth.resetPassword.sameDeviceNotice")}
                  </Text>
                </View>
              </View>

              <Pressable
                className="bg-primary rounded-xl py-4 items-center mb-4"
                onPress={() => navigation.navigate("Login")}
              >
                <Text className="text-white font-semibold text-base">
                  {t("auth.goToLogin")}
                </Text>
              </Pressable>

              <Pressable
                className={`items-center py-2 ${loading ? "opacity-50" : ""}`}
                onPress={handleSend}
                disabled={loading}
                hitSlop={8}
              >
                <Text className="text-text-secondary text-[15px] font-medium underline">
                  {loading ? "..." : t("auth.resetPassword.resend")}
                </Text>
              </Pressable>

              {error && (
                <Text className="text-error text-[15px] text-center mt-4">{error}</Text>
              )}
            </>
          ) : (
            <>
              <Text className="text-text text-2xl font-bold mb-2">
                {t("auth.resetPassword.title")}
              </Text>
              <Text className="text-text-secondary text-base mb-8 leading-6">
                {t("auth.resetPassword.subtitle")}
              </Text>

              <View className="mb-4">
                <TextInput
                  className="bg-surface-secondary border border-surface-tertiary rounded-xl px-4 py-3.5 text-text text-base"
                  placeholder={t("auth.email")}
                  placeholderTextColor="#9C9589"
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    setError(null);
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoFocus
                />
              </View>

              {error && <Text className="text-error text-[15px] mb-4">{error}</Text>}

              <Pressable
                className={`rounded-xl py-4 items-center mb-6 ${
                  isValid && !loading ? "bg-primary" : "bg-primary/40"
                }`}
                onPress={handleSend}
                disabled={!isValid || loading}
              >
                <Text className="text-white font-semibold text-base">
                  {loading ? "..." : t("auth.resetPassword.sendButton")}
                </Text>
              </Pressable>

              <View className="items-center">
                <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
                  <Text className="text-text-secondary text-[15px] font-medium">
                    {t("common.cancel")}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
