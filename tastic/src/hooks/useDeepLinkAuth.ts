import { useEffect } from "react";
import { Linking } from "react-native";
import { exchangeAuthCode, getAuthCodeFromUrl, isRecoveryUrl } from "../services/auth";
import { useAuthStore } from "../stores/authStore";

/**
 * 앱으로 들어오는 딥링크(이메일 확인 링크 등)에서 PKCE 인증 코드를 추출해
 * 세션으로 교환한다. 이메일 확인 후 같은 기기에서 링크를 누르면 AsyncStorage 에
 * 저장된 code_verifier 로 교환이 성공해 자동 로그인된다.
 *
 * OAuth 콜백(안드로이드 Custom Tabs)이 여기로도 들어올 수 있는데, signInWithGoogle 의
 * WebBrowser 반환 경로와 같은 code 를 동시에 교환하면 verifier 가 한 번만 존재해 한쪽이
 * "PKCE code verifier not found in storage" 로 실패한다. exchangeAuthCode 로 code 단위
 * dedupe 하여 이미 교환된 code 는 조용히 건너뛴다.
 *
 * 비밀번호 재설정 링크(auth/reset-password)도 같은 모양의 code 를 들고 오는데,
 * 이건 세션만 만들고 끝내면 안 된다 — 교환 성공 시 곧바로 SIGNED_IN 이 발생해
 * 사용자가 새 비밀번호를 정하지 못한 채 Main 으로 들어가 버린다. 그래서 교환
 * **이전에** 복구 플래그를 세워, 세션이 생기는 순간 라우터가 이미 재설정 화면을
 * 향하고 있게 한다(중간에 Main 이 한 프레임 스치는 것도 막는다).
 */
export function useDeepLinkAuth() {
  useEffect(() => {
    const handleUrl = async (url: string | null) => {
      if (!url) return;
      const code = getAuthCodeFromUrl(url);
      if (!code) return;
      const recovery = isRecoveryUrl(url);
      // 교환 실패(만료·다른 기기) 시에도 플래그는 유지한다. 재설정 화면이 세션
      // 없음을 감지해 "링크가 만료됐다"고 안내하고 재요청 경로를 열어준다 —
      // 여기서 플래그를 내리면 사용자는 아무 일도 안 일어난 로그인 화면만 본다.
      if (recovery) useAuthStore.getState().setPasswordRecovery(true);
      try {
        await exchangeAuthCode(code);
      } catch (e) {
        console.error("deep link auth exchange error:", e);
      }
    };

    // 앱이 종료 상태에서 링크로 열린 경우
    Linking.getInitialURL().then(handleUrl);
    // 앱이 실행 중일 때 링크 수신
    const sub = Linking.addEventListener("url", ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []);
}
