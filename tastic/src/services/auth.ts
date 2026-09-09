import { supabase } from "./supabase";
import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as AppleAuthentication from "expo-apple-authentication";

WebBrowser.maybeCompleteAuthSession();

// PKCE OAuth/이메일 확인 콜백 URL(예: tastic://auth/callback?code=...)에서 인증 코드를 추출한다.
// exchangeCodeForSession 은 전체 URL 이 아니라 code 문자열만 받는다.
export function getAuthCodeFromUrl(url: string): string | null {
  const match = url.match(/[?&]code=([^&#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// 비밀번호 재설정 메일의 콜백 경로. 가입 확인(auth/callback)과 **반드시 달라야** 한다 —
// 경로가 같으면 세션만 만들어지고 그대로 Main 으로 들어가, 새 비밀번호를 정할 화면을
// 영영 못 본다. 이 경로로 들어온 링크만 복구 플로우로 분기한다(useDeepLinkAuth).
export const RESET_PASSWORD_PATH = "auth/reset-password";

// Expo Go(exp://...--/auth/reset-password)와 standalone(tastic://auth/reset-password)의
// 형태가 달라 경로 문자열 포함 여부로 판별한다.
export function isRecoveryUrl(url: string): boolean {
  return url.includes(RESET_PASSWORD_PATH);
}

// 하나의 인증 코드가 두 경로에서 동시에 교환되는 것을 막는다.
// OAuth 콜백은 WebBrowser.openAuthSessionAsync 의 반환 URL 로도 오고, 안드로이드(Custom Tabs)에서는
// 전역 딥링크 리스너(useDeepLinkAuth)로도 온다. 둘이 같은 code 를 exchangeCodeForSession 에 넘기면
// 먼저 성공한 쪽이 code_verifier 를 지워, 나중 호출이 "PKCE code verifier not found in storage" 로
// 실패한다(에러가 UI 다이얼로그로 노출됨). code 단위로 1회만 교환하도록 dedupe 한다.
const exchangedCodes = new Set<string>();

export async function exchangeAuthCode(code: string) {
  // 이미 다른 경로가 교환 중이거나 완료했다면 재교환하지 않는다.
  // (verifier 는 성공/실패 무관하게 소비돼 재시도해도 무의미하다.)
  if (exchangedCodes.has(code)) return null;
  exchangedCodes.add(code);
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
  return data;
}

interface SignUpParams {
  email: string;
  password: string;
  nickname: string;
}

// 가입 시점에는 인증 + 닉네임만 받는다. 관심 카테고리 등 프로필은 가입 방식
// (이메일/구글/애플)과 무관하게 온보딩 화면에서 일괄 입력한다.
export async function signUp({ email, password, nickname }: SignUpParams) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // 이메일 확인 링크를 앱으로 되돌려 useDeepLinkAuth 가 세션을 교환하게 한다.
      emailRedirectTo: makeRedirectUri({ path: "auth/callback" }),
      data: { nickname },
    },
  });

  if (error) throw error;

  return data;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function resendConfirmation(email: string) {
  const { data, error } = await supabase.auth.resend({
    type: 'signup',
    email: email,
  });
  if (error) throw error;
  return data;
}

// 비밀번호 재설정 메일 발송.
//
// 계정이 없는 이메일이어도 에러를 던지지 않는다(Supabase 도 동일하게 성공을 준다) —
// 화면은 항상 같은 안내를 보여줘야 한다. 여기서 "없는 계정입니다"를 노출하면
// 가입 여부를 확인하는 계정 열거(enumeration) 통로가 된다.
//
// 링크는 PKCE 라서 **요청한 기기에서** 열어야 한다. code_verifier 가 그 기기
// AsyncStorage 에만 있기 때문. 다른 기기(PC 메일)에서 열면 교환이 실패하므로
// 화면 안내와 ResetPasswordScreen 의 만료 처리로 받아낸다.
export async function requestPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: makeRedirectUri({ path: RESET_PASSWORD_PATH }),
  });
  if (error) throw error;
}

// 복구 링크로 만들어진 세션 위에서 새 비밀번호를 확정한다.
export async function updatePassword(newPassword: string) {
  const { data, error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  return data;
}

export async function signInWithGoogle() {
  const redirectTo = makeRedirectUri({
    path: "auth/callback",
  });

  // access_type=offline / prompt=consent 는 구글 API 호출용 리프레시 토큰을 받고
  // 매 로그인마다 동의 화면을 강제할 때만 필요하다. Tastic 은 Supabase 세션만 쓰고
  // 구글 API 를 부르지 않으므로 불필요하다.
  // skipBrowserRedirect: 리다이렉트 제어를 전적으로 openAuthSessionAsync 에 맡겨,
  // 인증 후 콜백이 브라우저로 새어나가(안드로이드에서 mailto 로 오처리) 앱 복귀가
  // 실패하는 것을 막는다. (Supabase 공식 RN 패턴)
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) throw error;

  // Open the OAuth provider's authentication URL
  if (data.url) {
    const result = await WebBrowser.openAuthSessionAsync(
      data.url,
      redirectTo
    );

    if (result.type === "success") {
      const code = getAuthCodeFromUrl(result.url);
      if (!code) throw new Error("인증 코드를 받지 못했습니다");
      // 딥링크 리스너가 먼저 교환했다면 null 이 반환되지만, 세션은 이미 생성돼
      // onAuthStateChange(SIGNED_IN)로 반영되므로 화면 전환에는 문제가 없다.
      return await exchangeAuthCode(code);
    }
  }

  return data;
}

// 버튼은 iOS에서만 노출된다(LoginScreen). App Store 심사 가이드라인은 iOS에서
// 웹 리다이렉트 방식을 허용하지 않으므로 네이티브 Sign in with Apple 시트
// (ASAuthorizationController)로 받은 identityToken 을 signInWithIdToken 으로 교환한다.
export async function signInWithApple() {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    if (!credential.identityToken) {
      throw new Error("Apple 인증 토큰을 받지 못했습니다");
    }

    const { data: sessionData, error: sessionError } =
      await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: credential.identityToken,
      });
    if (sessionError) throw sessionError;
    return sessionData;
  } catch (e) {
    // 사용자가 시트를 닫은 경우는 오류로 취급하지 않고 조용히 종료한다.
    if (
      e instanceof Error &&
      "code" in e &&
      (e as { code?: string }).code === "ERR_REQUEST_CANCELED"
    ) {
      return null;
    }
    throw e;
  }
}
