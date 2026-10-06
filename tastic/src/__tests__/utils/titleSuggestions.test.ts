// 정정 제목 칩(ISSUE-032): 서버가 suggested_titles 를 주면 후보 0건일 때 칩을 띄우고,
// 탭하면 그 제목으로 새 verify-content 요청을 보낸다.
// 이 프로젝트엔 RN 렌더러가 없어 화면(ContentConfirmScreen)이 쓰는 판단·요청 함수를 검증한다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  freshSearchRequest,
  koreanObjectParticle,
  visibleTitleSuggestions,
} from "../../utils/titleSuggestions";
import { verifyContent } from "../../services/claude";
import type { ContentCandidate } from "../../types/llm";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock("../../services/supabase", () => ({
  supabase: { functions: { invoke: mockInvoke } },
}));

const candidate: ContentCandidate = {
  title: "디거",
  original_title: "Digger",
  creator: null,
  year: 2020,
  genre: null,
  confidence: "high",
} as ContentCandidate;

describe("visibleTitleSuggestions — 칩 노출", () => {
  it("후보 0건 + suggested_titles → 칩을 띄운다", () => {
    expect(
      visibleTitleSuggestions({ candidates: [], suggested_titles: ["디거", "Digger"] }, ["디거즈"]),
    ).toEqual(["디거", "Digger"]);
  });

  it("후보가 있으면 띄우지 않는다", () => {
    expect(
      visibleTitleSuggestions({ candidates: [candidate], suggested_titles: ["Digger"] }, ["디거즈"]),
    ).toEqual([]);
  });

  it("suggested_titles 가 없으면(구버전 서버 포함) 띄우지 않는다", () => {
    expect(visibleTitleSuggestions({ candidates: [] }, ["디거즈"])).toEqual([]);
  });

  it("이미 검색한 제목은 빼서 같은 제목으로 되돌아가는 순환을 막는다", () => {
    expect(
      visibleTitleSuggestions(
        { candidates: [], suggested_titles: ["디거즈", " 디거 ", "digger", "Digger"] },
        ["디거즈", "Digger"],
      ),
    ).toEqual(["디거"]);
  });
});

describe("칩 탭 → 새 verify-content 요청", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("정정 제목으로 캐시 사용·별칭 패스 비강제의 새 요청을 보낸다", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { candidates: [candidate] }, error: null });

    const res = await verifyContent(
      freshSearchRequest({ category: "movie", language: "ko", creator: undefined }, "디거"),
    );

    expect(res.candidates).toEqual([candidate]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [fn, init] = mockInvoke.mock.calls[0];
    expect(fn).toBe("verify-content");
    expect(init.body).toMatchObject({ title: "디거", category: "movie", skipCache: false, retry: false });
  });
});

describe("koreanObjectParticle", () => {
  it.each([
    ["디거", "를"],
    ["기생충", "을"],
    ["Digger", "를"],
    ["피의 게임 3", "를"],
  ])("%s → %s", (word, particle) => {
    expect(koreanObjectParticle(word)).toBe(particle);
  });
});
