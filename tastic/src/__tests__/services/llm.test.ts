// Edge Function 공통 LLM 호출(_shared/llm.ts)의 재시도 동작.
// 배경(ISSUE-021): 딥시크가 잘린/깨진 JSON을 주면 JSON.parse 가 그대로 던져 500이 됐다.
// 빈 응답·파싱 실패·finish_reason "length" 는 모두 1회만 재시도해야 한다.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

interface LlmModule {
  callJsonLLM(prompt: string, options?: Record<string, unknown>): Promise<unknown>;
}

// Deno 전역을 참조하는 모듈이라 RN tsconfig 의 타입 검사에 끌려 들어가지 않도록
// 경로를 string 변수로 두고 동적 import 한다. 모듈 로드 시 env 를 읽으므로 매번 새로 로드.
const LLM_MODULE_PATH: string = "../../../supabase/functions/_shared/llm";

function chatResponse(content: string | null, finishReason: string = "stop") {
  return new Response(
    JSON.stringify({
      model: "deepseek-flash",
      choices: [{ message: { content }, finish_reason: finishReason }],
      usage: { completion_tokens: 10 },
    }),
    { status: 200 },
  );
}

async function loadLlm(env: Record<string, string | undefined>): Promise<LlmModule> {
  vi.stubGlobal("Deno", { env: { get: (key: string) => env[key] } });
  vi.resetModules();
  return (await import(LLM_MODULE_PATH)) as LlmModule;
}

describe("callJsonLLM 재시도", () => {
  const fetchMock = vi.fn();
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const env = { DEEPSEEK_API_KEY: "test-key", DEEPSEEK_MODEL: "deepseek-flash" };

  it("잘린 JSON → 1회 재시도 후 성공", async () => {
    fetchMock
      .mockResolvedValueOnce(chatResponse('{"review": "앞부분만 오고 잘'))
      .mockResolvedValueOnce(chatResponse('{"review": "ok"}'));
    const { callJsonLLM } = await loadLlm(env);

    await expect(callJsonLLM("json prompt")).resolves.toEqual({ review: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(
      "callJsonLLM: JSON 파싱 실패 — 1회 재시도:",
      { finish_reason: "stop", contentLength: '{"review": "앞부분만 오고 잘'.length },
    );
  });

  it("잘린 JSON 이 두 번 연속 → 재시도는 1회뿐이고 실패, 에러에 content 원문이 없다", async () => {
    const secret = '{"review": "사용자 인터뷰 원문';
    fetchMock.mockImplementation(async () => chatResponse(secret));
    const { callJsonLLM } = await loadLlm(env);

    const err = await callJsonLLM("json prompt").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain("사용자 인터뷰 원문");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("사용자 인터뷰 원문");
    }
  });

  it("finish_reason=length → 파싱 가능해도 1회 재시도 후 성공", async () => {
    fetchMock
      .mockResolvedValueOnce(chatResponse('{"review": "cut"}', "length"))
      .mockResolvedValueOnce(chatResponse('{"review": "full"}'));
    const { callJsonLLM } = await loadLlm(env);

    await expect(callJsonLLM("json prompt")).resolves.toEqual({ review: "full" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(
      "callJsonLLM: JSON 파싱 실패 — 1회 재시도:",
      { finish_reason: "length", contentLength: '{"review": "cut"}'.length },
    );
  });

  it("finish_reason=length 가 두 번 연속 → 1회 재시도 후 실패", async () => {
    fetchMock.mockImplementation(async () => chatResponse('{"review": "cut"}', "length"));
    const { callJsonLLM } = await loadLlm(env);

    await expect(callJsonLLM("json prompt")).rejects.toThrow(/malformed JSON/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("빈 content → 1회 재시도 후 성공", async () => {
    fetchMock
      .mockResolvedValueOnce(chatResponse(""))
      .mockResolvedValueOnce(chatResponse('{"question": "q"}'));
    const { callJsonLLM } = await loadLlm(env);

    await expect(callJsonLLM("json prompt")).resolves.toEqual({ question: "q" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("빈 content 가 두 번 연속 → 1회 재시도 후 실패", async () => {
    fetchMock.mockImplementation(async () => chatResponse(null));
    const { callJsonLLM } = await loadLlm(env);

    await expect(callJsonLLM("json prompt")).rejects.toThrow(/empty content/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("HTTP 에러는 재시도하지 않는다", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 }),
    );
    const { callJsonLLM } = await loadLlm(env);

    await expect(callJsonLLM("json prompt")).rejects.toThrow("rate limited");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("served 로그는 'deepseek served: <모델>' 로 시작하고 끝에 finish: 가 붙는다", async () => {
    fetchMock.mockResolvedValueOnce(chatResponse('{"a": 1}', "stop"));
    const { callJsonLLM } = await loadLlm(env);

    await callJsonLLM("json prompt");
    const served = logSpy.mock.calls.find((c) => c[0] === "deepseek served:");
    expect(served?.[1]).toBe("deepseek-flash");
    expect(served?.slice(-2)).toEqual(["finish:", "stop"]);
  });
});
