import type { VerifyContentRequest, VerifyContentResponse } from "../types/llm";

// "혹시 '…'를 찾으시나요?" 정정 제목 칩 (ISSUE-032).
// 서버가 별칭을 찾고도 재검색할 시간이 없어 후보 0건으로 끝났을 때만 띄운다.

const MAX_SUGGESTIONS = 3;

function normalize(title: string): string {
  return title.trim().toLowerCase();
}

/**
 * 화면에 띄울 정정 제목. 후보가 있으면 띄우지 않는다(사용자는 후보를 고르면 된다).
 * 이미 검색해 본 제목(원래 입력 포함)은 빼서 같은 제목으로 되돌아가는 순환을 막는다.
 */
export function visibleTitleSuggestions(
  response: Pick<VerifyContentResponse, "candidates" | "suggested_titles">,
  triedTitles: string[],
): string[] {
  if (response.candidates.length > 0) return [];
  const tried = new Set(triedTitles.map(normalize));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of response.suggested_titles ?? []) {
    const title = raw.trim();
    const key = normalize(title);
    if (!title || tried.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(title);
    if (result.length === MAX_SUGGESTIONS) break;
  }
  return result;
}

/**
 * 재검색이 아닌 새 verify-content 요청. 첫 검색과 정정 제목 칩 탭이 같은 조건을 쓴다 —
 * 캐시를 쓰고(정정 제목은 캐시에 있을 수 있다) 별칭 패스를 강제하지 않는다.
 * 새 요청이므로 서버 예산(28초)을 새로 받는다.
 */
export function freshSearchRequest(
  base: Omit<VerifyContentRequest, "title" | "skipCache" | "retry">,
  title: string,
): VerifyContentRequest {
  return { ...base, title, skipCache: false, retry: false };
}

/**
 * 한국어 목적격 조사(을/를). 마지막 글자가 받침 있는 한글이면 "을", 그 외(받침 없음·영문·숫자)는 "를".
 * 영문은 읽는 법을 알 수 없어 "를"로 둔다 — Digger → "디거를".
 */
export function koreanObjectParticle(word: string): "을" | "를" {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    return (code - 0xac00) % 28 === 0 ? "를" : "을";
  }
  return "를";
}
