// verify-content 별칭 단계(supabase/functions/verify-content/aliasStage.ts)의 예산 판단.
// 배경(ISSUE-032): 실측 ~11초 걸리는 2패스를 5~10초 예산으로 시작해 정답 별칭(Digger, 디거)을
// 찾고도 항상 타임아웃으로 버려졌다. 끝까지 돌 시간이 없으면 2패스를 시작하지 않고
// 별칭을 suggested_titles 로 돌려줘야 한다. 웹서치 호출은 mock.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ALIAS_RESEARCH_MIN_BUDGET_MS,
  runAliasStage,
  suggestedTitlesFor,
  type AliasStageDeps,
} from "../../../supabase/functions/verify-content/aliasStage";

interface Pass {
  candidates: unknown[];
}

// remainingMs 를 단계별로 지정한다: [해석 진입 판단, 해석 예산, 2패스 진입 판단, 2패스 예산]
function deps(
  remaining: number[],
  resolved: { aliases: string[]; timedOut: boolean },
  second: Pass | Error = { candidates: [{ title: "디거" }] },
) {
  const queue = [...remaining];
  const d = {
    remainingMs: vi.fn(() => queue.shift() ?? 0),
    resolveAliases: vi.fn(async () => resolved),
    runPass: vi.fn(async () => {
      if (second instanceof Error) throw second;
      return second;
    }),
    countCandidates: (p: Pass) => p.candidates.length,
  } satisfies AliasStageDeps<Pass>;
  return d;
}

function timeoutError(): Error {
  const e = new Error("Signal timed out.");
  e.name = "TimeoutError";
  return e;
}

describe("runAliasStage — 2패스 진입 예산 (ISSUE-032)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("예산 부족 + 별칭 있음 → 2패스 미실행, no_budget, suggested_titles 반환", async () => {
    const d = deps([20_000, 20_000, ALIAS_RESEARCH_MIN_BUDGET_MS - 1], { aliases: ["Digger", "디거"], timedOut: false });

    const r = await runAliasStage("디거즈", d);

    expect(d.runPass).not.toHaveBeenCalled();
    expect(r.aliasOutcome).toBe("no_budget");
    expect(r.suggestedTitles).toEqual(["Digger", "디거"]);
    expect(r.second).toBeNull();
  });

  it("예전 기준(5초)이었으면 2패스를 시작했을 예산(8초)에서도 시작하지 않는다", async () => {
    const d = deps([20_000, 20_000, 8_000], { aliases: ["Digger"], timedOut: false });

    const r = await runAliasStage("디거즈", d);

    expect(d.runPass).not.toHaveBeenCalled();
    expect(r.aliasOutcome).toBe("no_budget");
  });

  it("별칭 없음 → suggested_titles 없음", async () => {
    const d = deps([20_000, 20_000, 20_000], { aliases: [], timedOut: false });

    const r = await runAliasStage("디거즈", d);

    expect(r.aliasOutcome).toBe("no_aliases");
    expect(r.suggestedTitles).toBeUndefined();
    expect(d.runPass).not.toHaveBeenCalled();
  });

  it("해석 단계 타임아웃 → timeout(resolve), 별칭이 없으니 suggested_titles 없음", async () => {
    const d = deps([20_000, 20_000], { aliases: [], timedOut: true });

    const r = await runAliasStage("디거즈", d);

    expect(r.aliasOutcome).toBe("timeout");
    expect(r.timeoutStage).toBe("resolve");
    expect(r.suggestedTitles).toBeUndefined();
  });

  it("예산 충분 → 기존대로 2패스 실행, applied (suggested_titles 없음)", async () => {
    const d = deps([20_000, 20_000, 14_000, 14_000], { aliases: ["Digger"], timedOut: false });

    const r = await runAliasStage("디거즈", d);

    expect(d.runPass).toHaveBeenCalledWith(["Digger"], 13_000);
    expect(r.aliasOutcome).toBe("applied");
    expect(r.second).toEqual({ candidates: [{ title: "디거" }] });
    expect(r.suggestedTitles).toBeUndefined();
  });

  it("2패스 타임아웃 → timeout(research), 감시 문자열 유지, suggested_titles 반환", async () => {
    const d = deps([20_000, 20_000, 14_000, 14_000], { aliases: ["Digger"], timedOut: false }, timeoutError());

    const r = await runAliasStage("디거즈", d);

    expect(r.aliasOutcome).toBe("timeout");
    expect(r.timeoutStage).toBe("research");
    expect(r.suggestedTitles).toEqual(["Digger"]);
    expect(console.error).toHaveBeenCalledWith(
      "verify-content alias re-search timed out:",
      expect.any(Error),
    );
  });

  it("2패스가 빈손 → no_result, 1패스 결과 유지", async () => {
    const d = deps([20_000, 20_000, 14_000, 14_000], { aliases: ["Digger"], timedOut: false }, { candidates: [] });

    const r = await runAliasStage("디거즈", d);

    expect(r.aliasOutcome).toBe("no_result");
    expect(r.second).toBeNull();
    expect(r.suggestedTitles).toBeUndefined();
  });

  it("해석 진입 예산도 없으면 아무것도 시작하지 않는다", async () => {
    const d = deps([8_000], { aliases: ["Digger"], timedOut: false });

    const r = await runAliasStage("디거즈", d);

    expect(d.resolveAliases).not.toHaveBeenCalled();
    expect(r.aliasOutcome).toBe("no_budget");
    expect(r.aliasAttempted).toBe(false);
  });
});

describe("suggestedTitlesFor", () => {
  it("입력 제목과 같은 문자열(대소문자·공백 무시)은 빼고 최대 3개", () => {
    expect(
      suggestedTitlesFor(" Digger ", ["digger", "디거", "Digger (2020)", "Diggers", "디거스"], "no_budget"),
    ).toEqual(["디거", "Digger (2020)", "Diggers"]);
  });

  it("no_budget/timeout 이 아니면 내보내지 않는다", () => {
    expect(suggestedTitlesFor("디거즈", ["Digger"], "applied")).toBeUndefined();
    expect(suggestedTitlesFor("디거즈", ["Digger"], "no_result")).toBeUndefined();
  });

  it("남는 게 없으면 undefined", () => {
    expect(suggestedTitlesFor("Digger", ["digger"], "no_budget")).toBeUndefined();
  });
});
