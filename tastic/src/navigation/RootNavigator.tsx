import React from "react";
import { ActivityIndicator, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuthStore } from "../stores/authStore";
import { useIntroStore } from "../stores/introStore";
import { useGuestStore } from "../stores/guestStore";
import { resolveAuthRoute } from "../utils/authRoute";
import type { RootStackParamList, AuthStackParamList } from "../types/navigation";
import { LoginScreen } from "../screens/Auth/LoginScreen";
import { SignUpScreen } from "../screens/Auth/SignUpScreen";
import { ForgotPasswordScreen } from "../screens/Auth/ForgotPasswordScreen";
import { ResetPasswordScreen } from "../screens/Auth/ResetPasswordScreen";
import { OnboardingScreen } from "../screens/Auth/OnboardingScreen";
import { ProfileErrorScreen } from "../screens/Auth/ProfileErrorScreen";
import { IntroTourScreen } from "../screens/Intro/IntroTourScreen";
import { MainTabs } from "./MainTabs";

const Stack = createNativeStackNavigator<RootStackParamList>();

// Separate auth navigator for Login/SignUp
const AuthNav = createNativeStackNavigator<AuthStackParamList>();

function AuthNavigator() {
  // 게스트가 '저장하기'로 넘어온 경우엔 회원가입부터 보여준다 — 체험 평론은 새로 만든
  // 계정으로만 이전되므로(utils/guestClaim.ts), 로그인 화면을 먼저 띄우면 사용자를
  // 평론이 저장되지 않는 경로로 안내하는 셈이 된다.
  // Auth 스택은 게스트 탈출 시점에 새로 마운트되므로 initialRouteName 이 매번 반영된다.
  const authTarget = useGuestStore((s) => s.authTarget);

  return (
    <AuthNav.Navigator
      screenOptions={{ headerShown: false }}
      initialRouteName={authTarget === "signUp" ? "SignUp" : "Login"}
    >
      <AuthNav.Screen name="Login" component={LoginScreen} />
      <AuthNav.Screen name="SignUp" component={SignUpScreen} />
      <AuthNav.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </AuthNav.Navigator>
  );
}

function LoadingScreen() {
  return (
    <View className="flex-1 bg-surface justify-center items-center">
      <ActivityIndicator size="large" color="#6366F1" />
    </View>
  );
}

export function RootNavigator() {
  const session = useAuthStore((s) => s.session);
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const profileStatus = useAuthStore((s) => s.profileStatus);
  const introSeen = useIntroStore((s) => s.seen);
  const isGuest = useGuestStore((s) => s.isGuest);
  // 비밀번호 재설정 링크로 진입한 상태 — 세션이 생겨도 Main 으로 보내지 않는다.
  const passwordRecovery = useAuthStore((s) => s.passwordRecovery);
  // 중단된 게스트 체험 복귀 판단이 끝나기 전까지는 라우트를 확정하지 않는다(useGuestInit).
  const guestBootstrapped = useGuestStore((s) => s.bootstrapped);

  // 가입/로그인 구분 없이 프로필이 비어있는 유저(소셜 첫 가입 등)는 온보딩으로 보낸다.
  // 분기 로직은 resolveAuthRoute 로 분리해 단위 테스트로 검증한다.
  const route = resolveAuthRoute({
    isLoading,
    hasSession: !!session,
    profileStatus,
    user,
    isGuest,
    passwordRecovery,
  });

  // 기능 가이드(기기당 최초 1회) — 로그인 이전, 앱을 처음 실행했을 때 노출한다.
  // 기기 로컬(AsyncStorage) 값이라 계정을 바꿔 로그인해도 다시 뜨지 않는다.
  // introSeen===null 은 아직 스토리지를 읽는 중이라 로딩으로 대기한다.
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {introSeen === null || !guestBootstrapped ? (
        <Stack.Screen name="Loading" component={LoadingScreen} />
      ) : introSeen === false && !passwordRecovery ? (
        // 비밀번호 재설정 링크로 들어온 경우엔 기능 가이드를 건너뛴다 — 링크를 눌렀는데
        // 인트로가 뜨면 재설정 화면에 영영 닿지 못한다(가이드는 다음 실행 때 보여준다).
        <Stack.Screen name="IntroTour" component={IntroTourScreen} />
      ) : route === "Loading" ? (
        <Stack.Screen name="Loading" component={LoadingScreen} />
      ) : route === "ResetPassword" ? (
        <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
      ) : route === "Auth" ? (
        <Stack.Screen name="Auth" component={AuthNavigator} />
      ) : route === "ProfileError" ? (
        <Stack.Screen name="ProfileError" component={ProfileErrorScreen} />
      ) : route === "Onboarding" ? (
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      ) : (
        <Stack.Screen name="Main" component={MainTabs} />
      )}
    </Stack.Navigator>
  );
}
