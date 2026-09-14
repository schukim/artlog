import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { callJsonLLM } from "../_shared/llm.ts";
import { enforceRateLimit } from "../_shared/usage.ts";
import { sameSeriesEntry } from "../_shared/seriesKey.ts";

// 유저별 작품 확정 일일 상한(비용 남용 방어). 요청마다 LLM(첫 질문 생성)을 부를 수 있어
// verify-content 와 동일한 abuse ceiling 을 둔다. 정상 사용자는 하루 수 건.
const WORK_SAVE_RATE_LIMIT_PER_DAY = 40;

// 작품 확정(ContentConfirmScreen에서 후보 선택) 시 호출.
// verify-content(웹서치 또는 캐시)로 식별된 작품을 works에 is_verified=true로 저장/승격해
// 전역 캐시로 공유한다. is_verified는 클라이언트가 직접 못 세우므로(가드 트리거) 서버에서만 수행.
//
// 동작:
//   1. search_works로 동일/유사 작품(>=0.85) 탐색
//   2. 있으면 그 행을 재사용 + 미검증이면 검증 승격(메타데이터 보강)
//   3. 없으면 새 행을 is_verified=true로 생성
// 수동 입력(유저가 직접 타이핑)은 이 함수를 쓰지 않고 기존 client insert(is_verified=false) 유지.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// 새 API 키 체계 프로젝트에선 SUPABASE_SERVICE_ROLE_KEY가 자동 주입되지 않을 수 있어 명시적 시크릿 우선.
const SERVICE_ROLE_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const REUSE_SIMILARITY_THRESHOLD = 0.85;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SaveWorkBody {
  title: string;
  category: string;
  originalTitle?: string | null;
  creator?: string | null;
  year?: number | null;
  genre?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface WorkInfo {
  title: string;
  category: string;
  creator?: string | null;
  year?: number | null;
  genre?: string | null;
  metadata?: Record<string, unknown> | null;
}

// 작품 확정 시점에 이 작품에 특화된 인터뷰 첫 질문 후보를 미리 생성해 metadata.first_questions에 캐싱한다.
// works 행은 전역 캐시로 공유되므로 작품당 1회 비용으로 모든 유저가 재사용한다.
// 실패해도 작품 저장을 막지 않는다 — 클라이언트가 하드코딩 템플릿으로 폴백.
async function generateFirstQuestions(work: WorkInfo): Promise<string[] | null> {
  try {
    const meta = work.metadata ?? {};
    const metaLines = Object.entries(meta)
      .filter(([k, v]) => k !== "first_questions" && v !== null && v !== undefined && v !== "")
      .map(([k, v]) => {
        if (Array.isArray(v)) return `- ${k}: ${(v as unknown[]).join(", ")}`;
        if (typeof v === "object") return `- ${k}: ${JSON.stringify(v)}`;
        return `- ${k}: ${v}`;
      })
      .join("\n");

    const prompt = `너는 문화 콘텐츠 감상 인터뷰어다. 사용자가 방금 감상을 마친 작품에 대한 인터뷰의 "첫 질문" 후보 3개를 만들어라.

이 질문은 기승전결 구조 인터뷰의 "기(첫인상)" 단계다. 답변들은 최종적으로 평론 한 편으로 재구성되며, 첫 질문의 역할은 사용자가 자기 감상의 중심(가장 강하게 남은 것)을 스스로 드러내게 해서 이후 질문들이 파고들 단서를 여는 것이다.

조건:
1. 이 작품에서만 물을 수 있는 질문일 것 — 아래 작품 정보의 구체 요소(키워드, 창작자 스타일, 시놉시스 등)를 자연스럽게 녹일 것
   - 나쁜 예: "이 영화에서 가장 인상적인 장면은 무엇이었나요?" (어느 작품에나 붙일 수 있음)
   - 좋은 예: "기생충에서 반지하와 저택, 두 공간을 오갈 때 어떤 감정이 들었나요?"
2. 질문에 담는 작품 사실은 아래 작품 정보에 명시된 것, 또는 네가 훈련 지식으로 확실히 아는 유명 작품의 정보만 쓸 것. 작품 정보가 빈약하고 확실히 아는 작품도 아니면 사실을 지어내지 말고, 조건 1을 포기하고 첫인상·감정을 여는 열린 질문으로 만들 것 — 이 질문은 캐싱되어 모든 유저에게 노출되므로 지어낸 특화는 반복 노출된다
3. 첫 질문이므로 부담 없이 답할 수 있을 것 — 첫인상, 감정, 기억에 남는 순간을 묻되 작품의 구체 요소에 닿아 있을 것
4. 열린 질문일 것 — 특정 측면에 대한 예/아니오나 단답으로 닫히지 않고, 사용자가 어디에 마음이 갔는지 방향을 스스로 고를 수 있는 형태 (이후 인터뷰가 그 방향을 따라간다)
5. 결말·반전 등 핵심 전개를 질문에 직접 언급하지 말 것
6. 평론가가 아닌 일반 감상자의 언어로, 질문은 한 문장으로
7. 한국어로 작성

반드시 아래 JSON 형식으로만 응답하라:
{"first_questions": ["질문1", "질문2", "질문3"]}

작품 정보:
- 제목: ${work.title}
- 카테고리: ${work.category}
- 창작자: ${work.creator ?? "정보 없음"}
- 연도: ${work.year ?? "정보 없음"}
- 장르: ${work.genre ?? "정보 없음"}
${metaLines}`;

    // 8초 타임아웃: 첫 질문 생성이 매달려도 작품 저장(핵심 플로우)을 막지 않는다
    // — 실패 시 템플릿 폴백
    const parsed = (await callJsonLLM(prompt, {
      temperature: 0.7,
      maxTokens: 512,
      timeoutMs: 8_000,
    })) as { first_questions?: unknown };
    const questions = (Array.isArray(parsed.first_questions) ? parsed.first_questions : [])
      .filter((q: unknown): q is string => typeof q === "string" && q.trim().length > 0)
      .slice(0, 5);
    return questions.length > 0 ? questions : null;
  } catch (e) {
    console.error("generateFirstQuestions failed — 템플릿 폴백:", e);
    return null;
  }
}

function hasFirstQuestions(metadata: unknown): boolean {
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    Array.isArray((metadata as Record<string, unknown>).first_questions) &&
    ((metadata as Record<string, unknown>).first_questions as unknown[]).length > 0
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { ...CORS } });
  }

  try {
    const body = (await req.json()) as SaveWorkBody;
    const { title, category } = body;
    if (!title || !category) {
      return new Response(
        JSON.stringify({ error: "invalid_request", message: "title/category 필수" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // userId 는 body 를 신뢰하지 않고 Authorization 토큰에서 꺼낸다
    // — 타 유저 명의로 작품 행을 만드는 것을 차단.
    // 아울러 유저별 일일 호출 상한을 강제 — LLM 호출·verified 행 무한 생성 남용 방어.
    const gate = await enforceRateLimit(req, "work_save", WORK_SAVE_RATE_LIMIT_PER_DAY, CORS);
    if (!gate.ok) return gate.response;
    const userId = gate.userId;

    // 1. 기존 작품 탐색
    // 임베딩 미전달 → 제목 trigram 유사도만으로 0~1 스케일이 되도록 가중치 조정
    // (기본 trigram 0.4 / embedding 0.6이면 점수가 최대 0.55로 묶여 0.85 재사용 판정 불가)
    const { data: matches, error: searchError } = await sb.rpc("search_works", {
      query_text: title,
      target_category: category,
      trigram_weight: 1.0,
      embedding_weight: 0.0,
      limit_count: 5,
    });
    if (searchError) console.error("save-verified-work search error:", searchError);

    // 속편/시즌 방어: 1편과 속편은 제목이 거의 같아 유사도가 재사용선을 넘는다
    // (실측 '악마는 프라다를 입는다' ↔ '…2' = 0.87). 이 경로는 매칭된 행의
    // creator/year/genre/metadata 를 **덮어쓰므로**, 잘못 붙으면 전역 캐시가 오염된다.
    // 번호가 다르면 다른 작품이니 재사용하지 않고 새 행을 만든다.
    const best = matches?.find((m) => sameSeriesEntry(title, m.title, m.original_title));
    if (best && best.similarity_score >= REUSE_SIMILARITY_THRESHOLD) {
      // 2. 재사용 + 검증 승격. 미검증 행이면 메타데이터를 우리 값으로 보강.
      const patch: Record<string, unknown> = {
        is_verified: true,
        verified_at: new Date().toISOString(),
      };
      if (!best.is_verified) {
        if (best.primary_source == null) patch.primary_source = "llm_verified";
        if (body.originalTitle != null) patch.original_title = body.originalTitle;
        if (body.creator != null) patch.creator = body.creator;
        if (body.year != null) patch.year = body.year;
        if (body.genre != null) patch.genre = body.genre;
        if (body.metadata && Object.keys(body.metadata).length > 0) patch.metadata = body.metadata;
      }
      // 첫 질문 캐시 보강: 최종 저장될 metadata에 first_questions가 없으면 생성해 병합
      const effectiveMetadata = (patch.metadata ?? best.metadata ?? {}) as Record<string, unknown>;
      if (!hasFirstQuestions(effectiveMetadata)) {
        // search_works RPC는 creator/year/genre를 반환하지 않으므로 확정된 후보 정보(body)로 보완
        const firstQuestions = await generateFirstQuestions({
          title: best.title ?? title,
          category,
          creator: (patch.creator ?? body.creator) as string | null,
          year: (patch.year ?? body.year) as number | null,
          genre: (patch.genre ?? body.genre) as string | null,
          metadata: effectiveMetadata,
        });
        if (firstQuestions) patch.metadata = { ...effectiveMetadata, first_questions: firstQuestions };
      }
      const { data: updated, error: updErr } = await sb
        .from("works")
        .update(patch)
        .eq("id", best.id)
        .select()
        .single();
      if (updErr) {
        console.error("save-verified-work promote error:", updErr);
        throw new Error(updErr.message);
      }
      return new Response(JSON.stringify({ work: updated, reused: true }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // 3. 신규 생성 (검증 캐시로)
    // 첫 질문 캐시: 작품 특화 인터뷰 첫 질문을 함께 생성해 metadata에 저장
    let newMetadata = (body.metadata ?? {}) as Record<string, unknown>;
    if (!hasFirstQuestions(newMetadata)) {
      const firstQuestions = await generateFirstQuestions({
        title,
        category,
        creator: body.creator,
        year: body.year,
        genre: body.genre,
        metadata: newMetadata,
      });
      if (firstQuestions) newMetadata = { ...newMetadata, first_questions: firstQuestions };
    }
    const { data: created, error: insErr } = await sb
      .from("works")
      .insert({
        user_id: userId,
        title,
        original_title: body.originalTitle ?? null,
        category,
        creator: body.creator ?? null,
        year: body.year ?? null,
        genre: body.genre ?? null,
        metadata: newMetadata,
        is_verified: true,
        verified_at: new Date().toISOString(),
        primary_source: "llm_verified",
      })
      .select()
      .single();
    if (insErr) {
      console.error("save-verified-work insert error:", insErr);
      throw new Error(insErr.message);
    }
    return new Response(JSON.stringify({ work: created, reused: false }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("save-verified-work error:", error);
    return new Response(
      JSON.stringify({ error: "save_failed", message: "작품 저장에 실패했습니다." }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
