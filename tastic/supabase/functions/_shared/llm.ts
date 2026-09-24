// JSON 모드 LLM 호출 공통 모듈 — DeepSeek 단독.
// 딥시크 JSON 모드 제약: 프롬프트에 "json"이라는 단어와 출력 예시가 반드시 포함되어야
// 하며, 간헐적으로 빈 content나 잘린/깨진 JSON을 반환할 수 있다 → 빈 응답·JSON 파싱
// 실패·finish_reason "length"(max_tokens 도달로 잘림)일 때 1회만 재시도.
// 웹서치가 필요한 verify-content/recommend-content는 OpenAI 호스티드 web_search에
// 의존하므로 이 모듈을 쓰지 않는다 (딥시크는 내장 웹서치 도구가 없음).

const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY") ?? "";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
// "deepseek-chat" 은 2026-07-24 지원 종료된 레거시 별칭.
// 폴백은 배포본 시크릿 DEEPSEEK_MODEL 과 같은 값으로 맞춘다 — 시크릿이 빠져도 모델이 바뀌지 않게.
const DEEPSEEK_MODEL_FALLBACK = "deepseek-flash";
const DEEPSEEK_MODEL_ENV = Deno.env.get("DEEPSEEK_MODEL");
if (!DEEPSEEK_MODEL_ENV) console.warn("DEEPSEEK_MODEL 미설정 — 폴백 사용:", DEEPSEEK_MODEL_FALLBACK);
const DEEPSEEK_MODEL = DEEPSEEK_MODEL_ENV || DEEPSEEK_MODEL_FALLBACK;

export interface JsonLLMOptions {
  temperature?: number;
  maxTokens?: number;
  // 시도당 타임아웃. 빈 응답 재시도는 드물고 빠르게 끝나므로
  // 사실상 이 값이 전체 소요 시간의 상한이다.
  timeoutMs?: number;
  // deepseek-flash는 사고모드가 기본 enabled/high라서 명시하지 않으면 추론 토큰이
  // max_tokens를 잠식해 타임아웃(8~12초)에 걸릴 수 있다. 기본값은 끔.
  thinking?: "disabled" | "low" | "high" | "max";
}

class EmptyContentError extends Error {}

// JSON.parse 실패 또는 finish_reason === "length". 메시지에 content 원문이나
// SyntaxError 메시지(원문 일부가 들어간다)를 넣지 않는다 — 사용자 인터뷰 내용이 담겨 있다.
class MalformedJsonError extends Error {
  constructor(readonly finishReason: string | null, readonly contentLength: number) {
    super(`LLM malformed JSON (finish: ${finishReason}, length: ${contentLength}, ${DEEPSEEK_MODEL})`);
  }
}

async function callChatJson(
  prompt: string,
  { temperature = 0.7, maxTokens = 1024, timeoutMs = 15_000, thinking = "disabled" }: JsonLLMOptions,
): Promise<unknown> {
  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature,
      max_tokens: maxTokens,
      thinking: thinking === "disabled"
        ? { type: "disabled" }
        : { type: "enabled", reasoning_effort: thinking },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json();
  const finishReason: string | null = data.choices?.[0]?.finish_reason ?? null;
  // req: 요청한 모델명. 벤더가 예고 없이 다른 모델로 라우팅해도 에러도 지표 이상도 없어서
  //   (2026-09: 당시 요청하던 deepseek-v4-flash 가 deepseek-flash 로 서빙됨) 요청/서빙을 나란히 남기지 않으면
  //   사후에 "무엇을 요청했는지"를 재구성할 방법이 없다.
  // usage: thinking:"disabled" 가 실제로 먹혔는지 보는 유일한 신호. 무시당하면 추론 토큰이
  //   max_tokens 를 잠식해 에러 없이 응답 품질과 지연만 나빠진다. 필드 구성이 모델마다 달라
  //   통째로 남긴다.
  // finish: "length" 면 max_tokens 에 걸려 JSON 이 잘린 것 — 파싱 실패 원인 구분용.
  // 앞부분 "deepseek served: <모델>" 은 기존 로그 수집이 파싱하는 형태라 그대로 유지한다.
  console.log(
    "deepseek served:", data.model,
    "req:", DEEPSEEK_MODEL,
    "thinking:", thinking,
    "usage:", JSON.stringify(data.usage ?? null),
    "finish:", finishReason,
  );
  if (data.model && data.model !== DEEPSEEK_MODEL) {
    console.warn(`deepseek model mismatch: req=${DEEPSEEK_MODEL} served=${data.model}`);
  }
  if (!res.ok) throw new Error(data.error?.message ?? `LLM HTTP ${res.status} (${DEEPSEEK_MODEL})`);
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new EmptyContentError(`LLM empty content (${DEEPSEEK_MODEL})`);
  }
  if (finishReason === "length") throw new MalformedJsonError(finishReason, content.length);
  try {
    return JSON.parse(content);
  } catch {
    throw new MalformedJsonError(finishReason, content.length);
  }
}

export async function callJsonLLM(prompt: string, options: JsonLLMOptions = {}): Promise<unknown> {
  if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY 미설정");
  try {
    return await callChatJson(prompt, options);
  } catch (e) {
    if (e instanceof EmptyContentError) {
      console.error("callJsonLLM: 빈 응답 — 1회 재시도:", e);
    } else if (e instanceof MalformedJsonError) {
      console.error("callJsonLLM: JSON 파싱 실패 — 1회 재시도:", {
        finish_reason: e.finishReason,
        contentLength: e.contentLength,
      });
    } else {
      throw e;
    }
    return await callChatJson(prompt, options);
  }
}
