// 로그인 실패 문구 분류 테스트.
// 화면이 서버 원문(영어)을 그대로 노출하던 회귀를 막고, emailNotConfirmed 일 때만
// '인증 메일 재전송'이 뜨도록 하는 분기의 근거가 되는 함수다.
import { describe, it, expect } from "vitest";
import { classifyAuthError, authErrorMessageKey } from "../../utils/authErrors";

// supabase-js 의 AuthApiError 형태(code + message)를 흉내낸다.
function authError(message: string, code?: string): Error {
  const e = new Error(message);
  if (code) (e as Error & { code?: string }).code = code;
  return e;
}

describe("classifyAuthError", () => {
  it("code 가 있으면 code 로 분류한다", () => {
    expect(classifyAuthError(authError("Invalid login credentials", "invalid_credentials"))).toBe(
      "invalidCredentials"
    );
    expect(classifyAuthError(authError("Email not confirmed", "email_not_confirmed"))).toBe(
      "emailNotConfirmed"
    );
  });

  it("code 가 없어도 서버 메시지로 분류한다", () => {
    // 구버전 응답이나 code 를 싣지 않는 경로를 위한 폴백.
    expect(classifyAuthError(authError("Invalid login credentials"))).toBe("invalidCredentials");
    expect(classifyAuthError(authError("Email not confirmed"))).toBe("emailNotConfirmed");
  });

  it("메일 발송 제한을 rateLimited 로 분류한다", () => {
    expect(
      classifyAuthError(
        authError("For security purposes, you can only request this after 60 seconds.", "over_email_send_rate_limit")
      )
    ).toBe("rateLimited");
    expect(classifyAuthError(authError("Request rate limit reached"))).toBe("rateLimited");
  });

  it("비밀번호 재설정 관련 에러를 구분한다", () => {
    expect(
      classifyAuthError(authError("New password should be different from the old password."))
    ).toBe("samePassword");
    expect(classifyAuthError(authError("Password should be at least 8 characters"))).toBe(
      "weakPassword"
    );
  });

  it("RN 의 네트워크 실패를 network 로 분류한다", () => {
    expect(classifyAuthError(new TypeError("Network request failed"))).toBe("network");
  });

  it("모르는 에러와 에러가 아닌 값은 unknown", () => {
    expect(classifyAuthError(authError("Something exploded"))).toBe("unknown");
    expect(classifyAuthError(null)).toBe("unknown");
    expect(classifyAuthError(undefined)).toBe("unknown");
    expect(classifyAuthError({})).toBe("unknown");
  });
});

describe("authErrorMessageKey", () => {
  it("i18n 키로 변환한다", () => {
    expect(authErrorMessageKey(authError("Email not confirmed", "email_not_confirmed"))).toBe(
      "auth.errors.emailNotConfirmed"
    );
    expect(authErrorMessageKey(null)).toBe("auth.errors.unknown");
  });
});
