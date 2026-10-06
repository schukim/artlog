import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { enforceUsageLimit, authenticateUser, adminClient } from "../_shared/usage.ts";
import { consumeGuestUsage, guestIdFrom } from "../_shared/guest.ts";
import { callJsonLLM } from "../_shared/llm.ts";

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
      const conversationText = conversation_history
        .map((e: { role: string; text: string }) =>
          `${e.role === "interviewer" ? "인터뷰어" : "사용자"}: ${e.text}`
        )
        .join("\n");

      // 프롬프트 설계 노트 (답변 나열 문제 해결):
      // - thesis를 JSON 첫 필드로 강제 — 자기회귀 생성 특성상 논지가 본문보다 먼저
      //   확정되므로, 별도 호출 없이 "논지를 세우고 그 축으로 쓰기"가 강제된다.
      // - 기존 구성 가이드("주제 2~3개를 연결")는 나열을 지시하는 레시피였음 →
      //   논지 축 아크(도입→전개→마찰→마무리)로 교체.
      // - 환각 억제를 재정의: 사실·감상 추가는 금지하되, 말한 감상들을 하나로 꿰는
      //   "관점 명명"은 허용·의무로 명시 (기존 조항이 축어적 재진술을 유발했음).
      const prompt = `너는 개인 평론 작성자다. 인터뷰 대화를 바탕으로 사용자의 감상을 하나의 논지를 가진 평론으로 벼려내라. 답변들을 순서대로 정리하는 것이 아니라, 답변들이 가리키는 하나의 관점을 찾아 그 축으로 글을 새로 짓는 것이 네 일이다.

## 작성 순서 — 반드시 이 순서로 사고하라

### 1단계: 논지(thesis) 수립
본문을 쓰기 전에, 인터뷰 답변 전체를 관통하는 한 문장을 먼저 세워라.
형식: "나는 이 작품을 ___한 작품으로 경험했다" 또는 그에 준하는 규정.
- 논지는 반드시 사용자의 답변들에서 도출한다. 답변들을 하나로 꿰는 관점에 이름을 붙이는 것은 사실 추가가 아니다 — 오히려 네 의무다.
  - 허용 예: "분위기가 무거웠다" + "롱테이크가 인상적이었다"라는 답변 → "느린 호흡이 만드는 밀도를 즐긴 감상"으로 명명 (말한 것들의 종합)
  - 금지 예: 사용자가 언급하지 않은 "배우의 연기"나 특정 장면을 근거로 추가 (말하지 않은 것의 발명)
- 답변이 짧고 파편적이어도 유효 턴 안에서 가장 강한 신호 하나를 골라 논지로 삼는다. 논지는 유효 턴에서만 도출한다 — 재료가 부족할 때 논지를 만들어내기 위해 말하지 않은 것을 끌어오는 것은 실패다.

### 2단계: 논지를 축으로 아크 구성
- 도입: 첫인상 또는 접하게 된 계기에서 시작해 논지를 예고한다.
- 전개: 논지를 뒷받침하는 감상들을 배치한다. 인터뷰에 나온 순서가 아니라 논지와의 관계에 따라 재배열하라.
- 마찰: 아쉬움·기대와 어긋난 점·의외였던 점이 인터뷰에 있으면 반드시 여기 배치한다. 마찰은 논지를 깨는 것이 아니라 입체화한다 ("그럼에도", "오히려 그래서"로 논지에 되먹임). 인터뷰에 마찰이 없으면 억지로 만들지 마라 — 없는 아쉬움의 발명은 환각이다.
- 마무리: 논지를 회수하며 이 작품이 남긴 것으로 닫는다. 도입의 단순 반복이나 앞 내용과 무관한 총평 금지.

## 유효 답변의 판별 — 다른 모든 지시보다 우선한다
평론을 쓰기 전에, 사용자 답변 턴을 둘로 나눈다.
- 유효 턴: 감상·사실·판단이 담긴 답변
- 무효 턴: 부정("아니야", "없었어", "아니요"), 회피("모르겠다", "글쎄"), 무응답, 또는 질문을 되돌려주는 답변

무효 턴은 평론의 소재에서 완전히 제외한다.
- 그 주제를 언급하지 않는다. 부재를 서술하지도 않는다. ("소리는 기억에 남지 않았다" 같은 문장도 쓰지 않는다)
- 부재에 의미를 부여하지 않는다. 사용자가 "없다"고 한 것에서 해석·반전·통찰을 만들어내는 것은 이 평론에서 가장 심각한 실패다.
- 무효 턴은 마찰이 아니다. "아쉬움이 없었다"는 답변으로 마찰 단락을 구성하지 않는다. 마찰 재료가 없으면 마찰 단락을 비운다.

인터뷰어의 발화는 소재가 아니라 맥락이다. 인터뷰어가 질문에 담아 제시한 작품 정보(감독·촬영 방식·트랙 수·줄거리 등)를 사용자가 느끼거나 알고 있던 것처럼 서술하지 않는다. 사용자가 그 정보에 반응한 경우, 근거가 되는 것은 인터뷰어의 정보가 아니라 사용자의 반응이다.

## 금지 패턴
1. 인터뷰 질문 순서를 그대로 따라가는 구성 (Q&A 나열의 흔적)
2. "또한", "그리고", "~도 좋았다"로 감상을 병렬 나열하는 문단
3. 사용자가 말하지 않은 사실·장면·감상·평가의 추가
4. 마무리에서 본문과 연결되지 않는 갑작스러운 포장식 결론

## 평론 작성 원칙
1. 화자 = 사용자: "나는", "내게" 등 1인칭 시점으로 작성. 사용자가 직접 쓴 것처럼 읽혀야 한다.
2. 감상 중심: 작품 줄거리 요약이 아닌, 사용자가 느끼고 생각한 것을 중심으로.
3. 문체: 문어체 평서문 — 모든 문장은 반드시 "~다"로 끝나는 평서형 종결어미("~했다", "~였다", "~싶다" 등)로 쓴다.
   - "~요", "~어요", "~습니다" 같은 구어체·경어체 종결은 절대 사용하지 않는다.
   - 인터뷰 답변이 구어체("좋았어요", "그랬던 것 같아요")여도 평론에서는 문어체("좋았다", "그랬다")로 변환한다.
   - 개인 에세이에 가까운 톤을 유지하되, 학술적이거나 저널리즘적 문체는 피한다.

## 분량
유효 턴 수에 따른다. 재료가 부족하면 짧게 쓴다 — 분량을 채우기 위한 추측·확장·대리 서술은 금지한다. 짧고 정확한 평론이 길고 지어낸 평론보다 낫다.
- 유효 턴 4개 이상: 한국어 400~800자 / 영어 200~400 words
- 유효 턴 2~3개: 한국어 200~400자 / 영어 100~200 words
- 유효 턴 1개 이하: 한국어 150자 내외 / 영어 80 words 내외

${language === "ko" ? "한국어" : "English"}로 작성하라.

반드시 아래 JSON 형식으로만 응답하라. thesis를 반드시 첫 번째로 작성하라:
{
  "thesis": "string — 사용자가 이 작품을 어떻게 규정하는지 한 문장",
  "review_text": "string",
  "suggested_title": "string"
}

작품 정보:
- 제목: ${content.title}
- 카테고리: ${content.category}
- 창작자: ${content.creator ?? "정보 없음"}
- 연도: ${content.year ?? "정보 없음"}
- 장르: ${content.genre ?? "정보 없음"}

인터뷰 대화:
${conversationText}`;

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
