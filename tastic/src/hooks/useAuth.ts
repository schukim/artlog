import { useEffect } from "react";
import { supabase } from "../services/supabase";
import { useAuthStore } from "../stores/authStore";
import { loadProfile } from "../services/profile";
import { syncUnsavedReviews } from "../services/review";
import { migrateGuestReview } from "../services/guestMigration";
import { useGuestStore } from "../stores/guestStore";
import { shouldClaimGuestReview } from "../utils/guestClaim";
import { clearGuestSession, clearGuestTrial } from "../utils/guestStorage";
import { identifyPurchasesUser, logOutPurchasesUser } from "../services/purchases";
import { reconcileSubscription } from "../services/subscription";
import * as Sentry from "@sentry/react-native";

// 세션이 생겼을 때 게스트 체험을 마무리한다.
//
// 이전은 **갓 만들어진 계정에만** 한다. 게스트 체험은 "가입 전 사용자가 만들어 본 평론을
// 새 계정으로 가져가는" 흐름이라, 이미 계정이 있는 사람이 체험 후 로그인한 경우에는
// 그 계정에 꽂지 않는다(그 계정의 오늘 무료 1편이 본인도 모르게 소진되는 것도 막는다).
// 이 경우 사용자는 로그인 화면에서 미리 안내를 보고 들어온다(LoginScreen).
//
// 이전에 실패하면 로컬 보관분은 남겨 다음 기회에 재시도한다.
async function finishGuestTrial(user: { id: string; created_at?: string }) {
  try {
    if (shouldClaimGuestReview(user.created_at)) {
      await migrateGuestReview(user.id);
    } else {
      // 기존 계정 로그인 — 체험은 여기서 종료하고 보관분을 정리한다.
      await clearGuestTrial();
    }
  } catch (e) {
    console.error("finishGuestTrial failed:", e);
  } finally {
    // 세션이 생긴 이상 게스트로 되돌아갈 일은 없다 — 이전 성공 여부와 무관하게
    // '진행 중 체험' 표시를 지운다. (남겨두면 나중에 로그아웃했을 때 게스트로 복귀한다.)
    await clearGuestSession().catch(() => {});
    useGuestStore.getState().clearGuest();
  }
}

export function useAuth() {
  const { setSession, setUser, setLoading } = useAuthStore();

  useEffect(() => {
    // Explicitly fetch the initial session — onAuthStateChange alone can miss
    // INITIAL_SESSION if the listener attaches after Supabase reads AsyncStorage.
    // try/finally 로 감싸 getSession 이 실패/지연돼도 isLoading 이 반드시 풀리게 한다.
    // (이게 없으면 깨진 인증 상태가 앱을 로딩 화면에 영구히 가둔다.)
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          await loadProfile(session.user.id);
          setSession(session);
          // RevenueCat appUserID를 맞춘 뒤(웹훅 매핑), 스토어 실제 구독 상태로 plan을 정합화.
          // iOS 만료 웹훅이 늦거나 유실돼도 앱이 스스로 만료를 반영한다(다운그레이드 전용).
          void identifyPurchasesUser(session.user.id).then(() => reconcileSubscription());
          // 저장 실패로 로컬에 남은 평론이 있으면 재업로드 (실패해도 다음 기회에 재시도)
          syncUnsavedReviews(session.user.id).catch(() => {});
          // 게스트 체험으로 만든 평론이 남아있으면 이 계정으로 이전
          void finishGuestTrial(session.user);
          // 크래시 추적용 user id (PII 최소화 — id만)
          Sentry.setUser({ id: session.user.id });
        } else {
          setUser(null);
          setSession(null);
        }
      } catch (e) {
        console.error("getSession failed:", e);
        setUser(null);
        setSession(null);
      } finally {
        setLoading(false);
      }
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        // onAuthStateChange 콜백 안에서 다른 supabase 호출(fetchProfile)을 직접 await 하면
        // auth 내부 lock 이 잡힌 채라 데드락이 나서 상태 반영이 지연된다
        // (로그인 직후 화면이 안 넘어가고 새로고침해야 넘어가는 증상). setTimeout(0) 으로
        // 락 밖으로 빼서 처리한다 — Supabase 공식 권장 패턴.
        setTimeout(async () => {
          if (session?.user) {
            await loadProfile(session.user.id);
            setSession(session);
            // RevenueCat appUserID를 맞춘 뒤(웹훅 매핑), 스토어 실제 구독 상태로 plan을 정합화.
            // iOS 만료 웹훅이 늦거나 유실돼도 앱이 스스로 만료를 반영한다(다운그레이드 전용).
            void identifyPurchasesUser(session.user.id).then(() => reconcileSubscription());
            // 게스트로 둘러보다 로그인한 경우 — 보관 중인 평론을 이 계정으로 이전.
            //
            // 단, 비밀번호 재설정 링크로 만들어진 세션에서는 미룬다. 이 세션은 "로그인
            // 하겠다"가 아니라 "비밀번호를 바꾸겠다"는 의사이고, 기존 계정이면
            // finishGuestTrial 이 보관 중인 체험 평론을 정리해버린다 — 사용자는 재설정만
            // 하려다 써둔 평론을 잃는다. 보관분은 남겨두고, 다음 실행의 getSession 경로가
            // 같은 처리를 이어받는다.
            if (!useAuthStore.getState().passwordRecovery) {
              void finishGuestTrial(session.user);
            }
            Sentry.setUser({ id: session.user.id });
          } else {
            setUser(null);
            setSession(null);
            void logOutPurchasesUser();
            Sentry.setUser(null);
          }
          setLoading(false);
        }, 0);
      }
    );

    return () => subscription.unsubscribe();
  }, [setSession, setUser, setLoading]);
}
