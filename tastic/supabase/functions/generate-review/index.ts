import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { enforceUsageLimit, authenticateUser, adminClient } from "../_shared/usage.ts";
import { consumeGuestUsage, guestIdFrom } from "../_shared/guest.ts";
import { callJsonLLM } from "../_shared/llm.ts";
import { buildReviewPrompt } from "./prompt.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  // x-guest-id: 비로그인 체험(게스트) 식별 헤더 — _shared/guest.ts 참조
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-guest-id",
};

// thinking "low" 에서도 reasoning 이 2600 토큰을 넘는 콜이 있어(10-04: completion 3037/3072,
// reasoning 2647) 3072 로는 본문 몫이 ~400 토큰뿐이었다 (ISSUE-024).
// 4096 상한: 실측 ~180 tok/s 라 그 이상은 시도당 25초 안에 다 못 쓴다.
async function callLLM(prompt: string, temperature = 0.4, maxTokens = 4096) {
  // 로컬 E2E용 mock — MOCK_LLM=true일 때만 동작 (배포 환경엔 미설정)
  if (Deno.env.get("MOCK_LLM") === "true") {
    return { thesis: "[mock] 논지", review_text: "[mock] 평론 본문", suggested_title: "[mock] 제목" };
  }
  // 클라이언트 타임아웃 30초 — 콜드스타트·전송 여유를 남기고 시도당 25초, 재시도 포함 합산 27초.
  return callJsonLLM(prompt, {
    temperature,
    maxTokens,
    timeoutMs: 25_000,
    totalTimeoutMs: 27_000,
    thinking: "low",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { ...CORS } });
  }

  try {
    const { content, conversation_history, language, interview_id, is_preview } = await req.json();

    // 게스트(비로그인 체험)는 세션이 없으므로 기기 UUID + 전역 상한 게이트를 탄다.
    // 게스트에겐 인터뷰 DB 레코드가 없어 refId 개념도, 멤버십 전용 미리보기도 없다.
    const guestId = await guestIdFrom(req);
    let release: () => Promise<void> = async () => {};

    if (guestId) {
      if (is_preview === true) {
        return new Response(
          JSON.stringify({
            error: "membership_required",
            message: language === "en"
              ? "Review preview is a membership-only feature."
              : "평론 미리보기는 멤버십 전용 기능이에요.",
          }),
          { status: 403, headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }
      const guestGate = await consumeGuestUsage(guestId, "review", CORS, language);
      if (!guestGate.ok) return guestGate.response;
    } else {
      // refId(재생성 중복 카운트 방지)는 "본인 소유 인터뷰"일 때만 인정한다.
      // 임의/타인 uuid 를 재사용해 free 일일 한도를 우회하는 것을 차단 —
      // 검증 실패 시 refId=null 로 일반 카운트 경로를 태운다.
      let refId: string | null = null;
      if (interview_id) {
        const auth = await authenticateUser(req, CORS, language === "en" ? "en" : "ko");
        if (!auth.ok) return auth.response;
        const { data: interview } = await adminClient()
          .from("interviews")
          .select("id")
          .eq("id", interview_id)
          .eq("user_id", auth.userId)
          .maybeSingle();
        if (interview) {
          refId = interview_id;
          // 재생성 횟수 계측. 실패해도 평론 생성 자체는 막지 않는다.
          // 미리보기(is_preview)는 멤버십 정상 흐름이라 불만족 신호가 아니므로 세지 않는다.
          if (is_preview !== true) {
            const { error: countError } = await adminClient().rpc(
              "increment_review_generate_count",
              { p_interview_id: interview_id },
            );
            if (countError) console.error("increment_review_generate_count failed:", countError);
          }
        }
      }

      // 미리보기는 멤버십 전용, 최종 생성은 free 하루 1편 제한.
      // 같은 인터뷰(ref_id)의 재생성은 추가 카운트하지 않는다.
      const gate = await enforceUsageLimit(req, "review", {
        refId,
        requireMembership: is_preview === true,
        // 미리보기는 멤버십 확인만 하고 사용량을 소비하지 않는다
        count: is_preview !== true,
        language,
        cors: CORS,
      });
      if (!gate.ok) return gate.response;
      release = gate.release;
    }

    let parsed: unknown;
    try {
      const prompt = buildReviewPrompt(content, conversation_history, language);

      parsed = await callLLM(prompt, 0.4);
    } catch (e) {
      await release(); // 예약 이후 어떤 실패(입력·LLM)든 사용량 롤백 (게스트는 no-op)
      throw e;
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("generate-review error:", error);
    return new Response(
      JSON.stringify({ error: "generation_failed", message: "평론을 생성하지 못했습니다." }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
