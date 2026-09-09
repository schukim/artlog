// 딥링크 URL 판별 테스트.
//
// 복구 링크를 가입 확인과 구분하지 못하면 세션만 만들어진 채 Main 으로 들어가
// 새 비밀번호 화면을 영영 못 본다 — 이 프로젝트에서 가장 값비싼 회귀라 형태별로 고정한다.
// standalone(tastic://)과 Expo Go(exp://host/--/path)의 URL 모양이 달라서 둘 다 검증한다.
import { describe, it, expect, vi } from "vitest";

// auth.ts 는 모듈 로드 시점에 네이티브 SDK 를 건드린다(WebBrowser.maybeCompleteAuthSession).
// 여기서 보는 건 순수 URL 파싱이라 주변 의존성은 전부 걷어낸다.
vi.mock("../../services/supabase", () => ({ supabase: { auth: {} } }));
vi.mock("expo-auth-session", () => ({ makeRedirectUri: vi.fn(() => "tastic://auth/callback") }));
vi.mock("expo-web-browser", () => ({
  maybeCompleteAuthSession: vi.fn(),
  openAuthSessionAsync: vi.fn(),
}));
vi.mock("expo-apple-authentication", () => ({
  signInAsync: vi.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

import { getAuthCodeFromUrl, isRecoveryUrl } from "../../services/auth";

describe("isRecoveryUrl", () => {
  it("standalone 스킴의 복구 콜백을 인식한다", () => {
    expect(isRecoveryUrl("tastic://auth/reset-password?code=abc123")).toBe(true);
  });

  it("Expo Go 개발 URL(exp://host/--/path)도 인식한다", () => {
    expect(
      isRecoveryUrl("exp://192.168.0.5:8081/--/auth/reset-password?code=abc123")
    ).toBe(true);
  });

  it("가입 확인 콜백은 복구가 아니다", () => {
    // 이게 true 가 되면 가입 확인이 재설정 화면에 갇힌다.
    expect(isRecoveryUrl("tastic://auth/callback?code=abc123")).toBe(false);
    expect(isRecoveryUrl("exp://192.168.0.5:8081/--/auth/callback?code=abc123")).toBe(false);
  });

  it("무관한 딥링크는 복구가 아니다", () => {
    expect(isRecoveryUrl("tastic://review/123")).toBe(false);
  });
});

describe("getAuthCodeFromUrl", () => {
  it("복구 콜백에서 code 를 뽑는다", () => {
    expect(getAuthCodeFromUrl("tastic://auth/reset-password?code=abc123")).toBe("abc123");
  });

  it("code 가 첫 파라미터가 아니어도 뽑는다", () => {
    expect(getAuthCodeFromUrl("tastic://auth/reset-password?type=recovery&code=abc123")).toBe(
      "abc123"
    );
  });

  it("URL 인코딩된 code 를 디코드한다", () => {
    expect(getAuthCodeFromUrl("tastic://auth/reset-password?code=a%2Bb%2Fc")).toBe("a+b/c");
  });

  it("error 만 담긴 콜백에서는 code 가 없다", () => {
    // 만료·거부 시 Supabase 는 code 없이 error 를 실어 보낸다.
    expect(
      getAuthCodeFromUrl("tastic://auth/reset-password?error=access_denied&error_code=otp_expired")
    ).toBeNull();
  });
});
