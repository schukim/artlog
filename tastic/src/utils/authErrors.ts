/**
 * Supabase 인증 에러를 사용자에게 보여줄 i18n 키로 옮긴다.
 *
 * 화면에서 `e.message` 를 그대로 뿌리면 서버가 주는 영어 원문
 * ("Invalid login credentials", "Email not confirmed")이 노출된다. 실제로
 * 비밀번호를 잊은 사용자가 영어 문구만 7번 보고 이탈한 사례가 있었다.
 *
 * 분류(kind)를 문자열로 돌려주는 이유는 화면이 문구뿐 아니라 **분기**에도
 * 쓰기 때문이다 — emailNotConfirmed 일 때만 '인증 메일 재전송' 버튼을 띄운다.
 */
export type AuthErrorKind =
  | "invalidCredentials"
  | "emailNotConfirmed"
  | "rateLimited"
  | "samePassword"
  | "weakPassword"
  | "network"
  | "unknown";

// supabase-js v2 는 AuthApiError 에 안정적인 `code` 를 실어 보낸다. 다만 구버전
// 응답이나 네트워크 계층 에러에는 code 가 없어서 메시지 매칭을 폴백으로 둔다.
const CODE_MAP: Record<string, AuthErrorKind> = {
  invalid_credentials: "invalidCredentials",
  email_not_confirmed: "emailNotConfirmed",
  over_email_send_rate_limit: "rateLimited",
  over_request_rate_limit: "rateLimited",
  same_password: "samePassword",
  weak_password: "weakPassword",
};

function readCode(e: unknown): string | null {
  if (typeof e === "object" && e !== null && "code" in e) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

function readMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "";
}

export function classifyAuthError(e: unknown): AuthErrorKind {
  const code = readCode(e);
  if (code && CODE_MAP[code]) return CODE_MAP[code];

  const message = readMessage(e).toLowerCase();
  if (!message) return "unknown";

  if (message.includes("email not confirmed")) return "emailNotConfirmed";
  if (message.includes("invalid login credentials")) return "invalidCredentials";
  if (message.includes("rate limit") || message.includes("too many requests")) return "rateLimited";
  // "New password should be different from the old password."
  if (message.includes("should be different")) return "samePassword";
  if (message.includes("password should be at least") || message.includes("weak password")) {
    return "weakPassword";
  }
  // RN 의 fetch 실패는 "Network request failed" 로 온다.
  if (message.includes("network request failed") || message.includes("failed to fetch")) {
    return "network";
  }

  return "unknown";
}

/** i18n 키를 돌려준다. 화면은 `t(authErrorMessageKey(e))` 로 쓴다. */
export function authErrorMessageKey(e: unknown): string {
  return `auth.errors.${classifyAuthError(e)}`;
}
