// verify-content 별칭(원제) 해석 → 2패스 재검색 단계. Deno 전역에 의존하지 않는 순수 모듈로 두어
// 예산 판단을 Vitest(src/__tests__/services/verifyContentAlias.test.ts)로 검증한다.
// 외부 호출(웹서치)은 deps 로 주입받는다.

// 별칭 해석(원제 문자열만 알아내는 짧은 질의) 상한. 실측 ~6초.
export const ALIAS_RESOLVE_BUDGET_MS = 9_000;
// 찾은 원제로 화이트리스트 검색을 다시 도는 2패스 상한. 실측 ~11초.
export const ALIAS_RESEARCH_BUDGET_MS = 13_000;
// 2패스를 시작하는 최소 남은 예산 (ISSUE-032). 실측 ~11초 걸리는 재검색을 5~10초로 시작하면
// 정답 별칭을 찾고도 항상 타임아웃으로 버려졌다(web_search 비용만 나감). 끝까지 돌 시간이 없으면
// 시작하지 않고, 찾은 별칭을 suggested_titles 로 돌려줘 사용자가 직접 다시 검색하게 한다.
export const ALIAS_RESEARCH_MIN_BUDGET_MS = 12_000;
// 사용자에게 제안하는 정정 제목 최대 개수
export const MAX_SUGGESTED_TITLES = 3;

export type AliasOutcome = "not_needed" | "no_budget" | "timeout" | "no_aliases" | "no_result" | "applied";

export interface AliasStageDeps<P> {
  remainingMs: () => number;
  resolveAliases: (budgetMs: number) => Promise<{ aliases: string[]; timedOut: boolean }>;
  runPass: (aliases: string[], budgetMs: number) => Promise<P>;
  countCandidates: (pass: P) => number;
}

export interface AliasStageResult<P> {
  // 2패스가 후보를 찾았을 때만 채워진다 — 호출부는 이걸로 1패스 결과를 교체한다.
  second: P | null;
  aliases: string[];
  aliasAttempted: boolean;
  aliasOutcome: AliasOutcome;
  // "timeout" 이 어느 단계에서 났는지. 해석(resolve) / 2패스 재검색(research).
  timeoutStage: "resolve" | "research" | null;
  resolveMs: number | null;
  researchMs: number | null;
  // 응답 suggested_titles. 별칭을 찾았지만 2패스로 반영하지 못했을 때만.
  suggestedTitles: string[] | undefined;
}

function isTimeout(e: unknown): boolean {
  const name = (e as Error)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

export function suggestedTitlesFor(
  title: string,
  aliases: string[],
  outcome: AliasOutcome,
): string[] | undefined {
  if (outcome !== "no_budget" && outcome !== "timeout") return undefined;
  const input = title.trim().toLowerCase();
  const titles = [...new Set(aliases.map((a) => a.trim()))]
    .filter((a) => a.length > 0 && a.toLowerCase() !== input)
    .slice(0, MAX_SUGGESTED_TITLES);
  return titles.length > 0 ? titles : undefined;
}

export async function runAliasStage<P>(title: string, deps: AliasStageDeps<P>): Promise<AliasStageResult<P>> {
  const result: AliasStageResult<P> = {
    second: null,
    aliases: [],
    aliasAttempted: false,
    aliasOutcome: "not_needed",
    timeoutStage: null,
    resolveMs: null,
    researchMs: null,
    suggestedTitles: undefined,
  };

  // 예산이 별칭 해석분도 안 되면 시작하지 않는다. 반쯤 하다 끊기면 시간만 버리고
  // 클라이언트 타임아웃을 유발한다 — 1패스 결과를 그대로 주는 편이 항상 낫다.
  if (deps.remainingMs() < ALIAS_RESOLVE_BUDGET_MS) {
    result.aliasOutcome = "no_budget";
    return result;
  }

  result.aliasAttempted = true;
  const resolveStart = Date.now();
  const resolved = await deps.resolveAliases(Math.min(ALIAS_RESOLVE_BUDGET_MS, deps.remainingMs()));
  result.resolveMs = Date.now() - resolveStart;
  result.aliases = resolved.aliases;

  if (resolved.timedOut) {
    result.aliasOutcome = "timeout";
    result.timeoutStage = "resolve";
  } else if (result.aliases.length === 0) {
    result.aliasOutcome = "no_aliases";
  } else if (deps.remainingMs() < ALIAS_RESEARCH_MIN_BUDGET_MS) {
    // 원제는 찾았지만 재검색을 끝까지 돌릴 시간이 없다 → 제안으로 돌려준다.
    result.aliasOutcome = "no_budget";
  } else {
    const budget = Math.min(ALIAS_RESEARCH_BUDGET_MS, deps.remainingMs());
    const researchStart = Date.now();
    try {
      const second = await deps.runPass(result.aliases, budget);
      // 2패스가 실제로 후보를 찾았을 때만 교체한다 — 빈손이면 1패스 결과를 지키는 게 낫다.
      if (deps.countCandidates(second) > 0) {
        result.second = second;
        result.aliasOutcome = "applied";
      } else {
        result.aliasOutcome = "no_result";
      }
    } catch (e) {
      const t = isTimeout(e);
      result.aliasOutcome = t ? "timeout" : "no_result";
      if (t) result.timeoutStage = "research";
      // 감시 문자열 — 문구를 바꾸지 말 것. (해석 단계는 "verify-content alias pass timed out")
      console.error(`verify-content alias re-search ${t ? "timed out" : "failed"}:`, e);
    }
    result.researchMs = Date.now() - researchStart;
  }

  result.suggestedTitles = suggestedTitlesFor(title, result.aliases, result.aliasOutcome);
  return result;
}
