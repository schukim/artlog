import type { User } from "../types/database";
import type { ProfileStatus } from "../stores/authStore";

export type AuthRoute =
  | "Loading"
  | "Auth"
  | "ResetPassword"
  | "ProfileError"
  | "Onboarding"
  | "Main";

/**
 * 인증 상태로부터 최상위 라우트를 결정한다. RootNavigator 의 분기와 동일한 로직을
 * 순수 함수로 분리해 단위 테스트 가능하게 한다.
 *
 * 가입/로그인은 구분하지 않는다 — Supabase 가 신규 유저를 만들고, 앱은 프로필이
 * 비었는지(`preferred_categories` 가 비어있는지)로만 온보딩 필요 여부를 판단한다.
 * 이메일·구글·애플 어떤 방식으로 가입하든 동일한 회로를 탄다.
 *
 * 세션은 있는데 프로필 조회가 끝나지 않았거나(loading) 실패했으면(error) Main 으로
 * 보내지 않는다 — user=null 인 채 Main 에 들어가 빈 화면/무동작이 되는 것을 막는다.
 *
 * 게스트(isGuest)는 세션 없이 Main 으로 보낸다 — App Store 5.1.1(v) 대응으로 가입 없이
 * 인터뷰·평론 생성을 체험할 수 있어야 하기 때문. 세션이 생기면 게스트 분기는 무시하고
 * 정상 인증 경로를 따른다(로그인 직후 useAuth 가 isGuest 를 내린다).
 *
 * 비밀번호 재설정(passwordRecovery)은 세션·프로필·게스트보다 **우선**한다. 복구 링크는
 * 정상 세션을 만들기 때문에, 우선하지 않으면 그대로 Main 으로 흘러가 새 비밀번호를
 * 정할 기회 자체가 사라진다. 세션이 없어도(교환 실패) 재설정 화면으로 보내 만료
 * 안내를 시킨다 — 로그인 화면으로 되돌리면 사용자는 아무 설명도 못 받는다.
 */
export function resolveAuthRoute(params: {
  isLoading: boolean;
  hasSession: boolean;
  profileStatus: ProfileStatus;
  user: Pick<User, "preferred_categories"> | null;
  isGuest?: boolean;
  passwordRecovery?: boolean;
}): AuthRoute {
  const { isLoading, hasSession, profileStatus, user, isGuest, passwordRecovery } = params;

  if (isLoading) return "Loading";
  if (passwordRecovery) return "ResetPassword";
  if (!hasSession) return isGuest ? "Main" : "Auth";

  // 세션은 있으나 프로필이 아직 안 들어옴 → 잠깐 로딩.
  if (profileStatus === "loading") return "Loading";
  // 프로필 조회 실패(네트워크/RLS/트리거 지연) → 재시도 화면. user=null 도 방어적으로 동일 처리.
  if (profileStatus === "error" || !user) return "ProfileError";

  const needsOnboarding = (user.preferred_categories?.length ?? 0) === 0;
  if (needsOnboarding) return "Onboarding";

  return "Main";
}
