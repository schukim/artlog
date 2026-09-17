// JSON 모드 LLM 호출 공통 모듈 — DeepSeek 단독.
// 딥시크 JSON 모드 제약: 프롬프트에 "json"이라는 단어와 출력 예시가 반드시 포함되어야
// 하며, 간헐적으로 빈 content를 반환할 수 있다 → 빈 응답일 때만 1회 재시도.
// 웹서치가 필요한 verify-content/recommend-content는 OpenAI 호스티드 web_search에
// 의존하므로 이 모듈을 쓰지 않는다 (딥시크는 내장 웹서치 도구가 없음).

const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY") ?? "";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
// "deepseek-chat" 은 2026-07-24 지원 종료된 레거시 별칭.
const DEEPSEEK_MODEL = Deno.env.get("DEEPSEEK_MODEL") ?? "deepseek-v4-flash";

export interface JsonLLMOptions {
  temperature?: number;
  maxTokens?: number;
  // 시도당 타임아웃. 빈 응답 재시도는 드물고 빠르게 끝나므로
  // 사실상 이 값이 전체 소요 시간의 상한이다.
  timeoutMs?: number;
  // v4-flash는 사고모드가 기본 enabled/high라서 명시하지 않으면 추론 토큰이
  // max_tokens를 잠식해 타임아웃(8~12초)에 걸릴 수 있다. 기본값은 끔.
  thinking?: "disabled" | "low" | "high" | "max";
}

class EmptyContentError extends Error {}

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
  // req: 요청한 모델명. 벤더가 예고 없이 다른 모델로 라우팅해도 에러도 지표 이상도 없어서
  //   (2026-09: deepseek-v4-flash 요청 → deepseek-flash 서빙) 요청/서빙을 나란히 남기지 않으면
  //   사후에 "무엇을 요청했는지"를 재구성할 방법이 없다.
  // usage: thinking:"disabled" 가 실제로 먹혔는지 보는 유일한 신호. 무시당하면 추론 토큰이
  //   max_tokens 를 잠식해 에러 없이 응답 품질과 지연만 나빠진다. 필드 구성이 모델마다 달라
  //   통째로 남긴다.
  // 앞부분 "deepseek served: <모델>" 은 기존 로그 수집이 파싱하는 형태라 그대로 유지한다.
  console.log(
    "deepseek served:", data.model,
    "req:", DEEPSEEK_MODEL,
    "thinking:", thinking,
    "usage:", JSON.stringify(data.usage ?? null),
  );
  if (data.model && data.model !== DEEPSEEK_MODEL) {
    console.warn(`deepseek model mismatch: req=${DEEPSEEK_MODEL} served=${data.model}`);
  }
  if (!res.ok) throw new Error(data.error?.message ?? `LLM HTTP ${res.status} (${DEEPSEEK_MODEL})`);
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new EmptyContentError(`LLM empty content (${DEEPSEEK_MODEL})`);
  }
  return JSON.parse(content);
}

export async function callJsonLLM(prompt: string, options: JsonLLMOptions = {}): Promise<unknown> {
  if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY 미설정");
  try {
    return await callChatJson(prompt, options);
  } catch (e) {
    if (!(e instanceof EmptyContentError)) throw e;
    console.error("callJsonLLM: 빈 응답 — 1회 재시도:", e);
    return await callChatJson(prompt, options);
  }
}
