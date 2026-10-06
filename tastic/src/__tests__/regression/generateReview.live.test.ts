// generate-review 프롬프트 회귀 — 실제 DeepSeek 호출(라이브).
// 외부 API 를 부르므로 기본 `npm run test` 에서는 건너뛴다. 실행:
//   DEEPSEEK_API_KEY=... DEEPSEEK_MODEL=deepseek-flash npx vitest run src/__tests__/regression
// DEEPSEEK_MODEL 은 배포 시크릿과 같은 값으로 맞출 것 (`npx supabase secrets list`).
// 출력이 확률적이라 케이스마다 RUNS 회 생성해 전부 통과해야 합격으로 본다.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { buildReviewPrompt } from "../../../supabase/functions/generate-review/prompt";
import {
  ASSASSINS_REQUEST_TURN,
  LIGHT_USER_AFFIRMED_SCENE,
  type ReviewFixture,
} from "./fixtures/generateReview";

interface ReviewOutput {
  thesis: string;
  review_text: string;
  suggested_title: string;
}

interface LlmModule {
  callJsonLLM(prompt: string, options?: Record<string, unknown>): Promise<unknown>;
}

// Deno 전역을 참조하는 모듈이라 RN tsconfig 타입 검사에 끌려오지 않게 동적 import.
const LLM_MODULE_PATH: string = "../../../supabase/functions/_shared/llm";
const RUNS = Number(process.env.REGRESSION_RUNS ?? 3);
const LIVE = Boolean(process.env.DEEPSEEK_API_KEY);

let llm: LlmModule;

async function generate(fixture: ReviewFixture): Promise<ReviewOutput[]> {
  const prompt = buildReviewPrompt(fixture.content, fixture.conversation, "ko");
  // index.ts 의 callLLM 과 같은 옵션. 타임아웃만 테스트 여유를 둔다.
  const outputs = await Promise.all(
    Array.from({ length: RUNS }, () =>
      llm.callJsonLLM(prompt, { temperature: 0.4, maxTokens: 4096, timeoutMs: 60_000, thinking: "low" }),
    ),
  );
  outputs.forEach((o, i) => console.info(`[${fixture.name}] #${i + 1}\n${JSON.stringify(o, null, 2)}`));
  return outputs as ReviewOutput[];
}

describe.skipIf(!LIVE)("generate-review 프롬프트 회귀 (live DeepSeek)", () => {
  beforeAll(async () => {
    vi.stubGlobal("Deno", { env: { get: (key: string) => process.env[key] } });
    llm = (await import(LLM_MODULE_PATH)) as LlmModule;
  });

  it("5ab32650: 논지는 특집쇼/몰입 저해 축, 부정 전제·요청 문구 미유입", async () => {
    for (const { thesis, review_text } of await generate(ASSASSINS_REQUEST_TURN)) {
      const all = `${thesis}\n${review_text}`;
      expect(thesis).toMatch(/특집|쇼|몰입|유명|배우|얼굴/);
      // ④ 부정된 전제("추적", "쫓는")가 대비 형태로도 들어오지 않아야 한다
      expect(all).not.toMatch(/쫓|추적|사슬/);
      // 평론 요청 턴의 문구가 인용되지 않아야 한다
      expect(all).not.toMatch(/고쳐|평론을|긴장감이 있다는 것보다|과장이 아니었/);
    }
  }, 180_000);

  it("라이트 유저: 긍정한 장면(②)이 막연한 ①을 제치고 논지가 된다", async () => {
    for (const { thesis } of await generate(LIGHT_USER_AFFIRMED_SCENE)) {
      expect(thesis).toMatch(/해변|모래|구덩이|밀물|바다|사라/);
    }
  }, 180_000);

  it("라이트 유저: 유효 턴 1개 이하 → 분량 150~200자", async () => {
    for (const { review_text } of await generate(LIGHT_USER_AFFIRMED_SCENE)) {
      const length = [...review_text.replace(/\s+/g, " ").trim()].length;
      expect(length).toBeGreaterThanOrEqual(150);
      expect(length).toBeLessThanOrEqual(200);
    }
  }, 180_000);
});
