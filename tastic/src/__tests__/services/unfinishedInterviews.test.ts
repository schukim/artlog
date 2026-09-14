// 마무리하지 못한 평론(홈 복구 카드) 조회 로직.
// 인터뷰는 끝났는데 평론이 없는 건만 골라야 한다 — 특히 "평론은 이미 있는데
// linkInterviewToReview 만 실패한" 건을 복구 카드로 띄우면 같은 평론을 두 번 쓰게 된다.
import { describe, it, expect, vi, beforeEach } from "vitest";

import { fetchUnfinishedInterviews } from "../../services/review";

const { mockFrom, results } = vi.hoisted(() => {
  const results: Record<string, unknown> = {};
  // Supabase 쿼리 빌더 흉내 — 어떤 메서드를 체이닝하든 자신을 돌려주고,
  // await 되는 순간 테이블별로 지정한 결과를 반환한다.
  const makeChain = (table: string) => {
    const chain: Record<string | symbol, unknown> = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown) =>
              Promise.resolve(results[table] ?? { data: [], error: null }).then(resolve);
          }
          return () => chain;
        },
      }
    ) as Record<string | symbol, unknown>;
    return chain;
  };
  const mockFrom = vi.fn((table: string) => makeChain(table));
  return { mockFrom, results };
});

vi.mock("../../services/supabase", () => ({ supabase: { from: mockFrom } }));

const work = { id: "work-1", title: "오디세이", category: "book" };

function interviewRow(over: Record<string, unknown> = {}) {
  return {
    id: "interview-1",
    work_id: "work-1",
    conversation: [{ role: "interviewer", text: "질문" }, { role: "user", text: "답변" }],
    created_at: "2026-09-01T00:00:00Z",
    works: work,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(results)) delete results[k];
});

describe("fetchUnfinishedInterviews", () => {
  it("평론이 없는 완료 인터뷰를 돌려준다", async () => {
    results.interviews = { data: [interviewRow()], error: null };
    results.reviews = { data: [], error: null };

    const list = await fetchUnfinishedInterviews("user-1");

    expect(list).toHaveLength(1);
    expect(list[0].work.title).toBe("오디세이");
    expect(list[0].conversation).toHaveLength(2);
  });

  it("인터뷰 이후에 생긴 평론이면 제외한다 — review_id 연결만 실패한 경우", async () => {
    results.interviews = { data: [interviewRow()], error: null };
    results.reviews = {
      data: [{ work_id: "work-1", created_at: "2026-09-01T00:01:00Z" }],
      error: null,
    };

    expect(await fetchUnfinishedInterviews("user-1")).toHaveLength(0);
  });

  it("인터뷰 이전에 쓴 평론은 제외 사유가 아니다 — 같은 작품을 다시 감상한 경우", async () => {
    // 지난달에 같은 작품 평론을 썼고, 오늘 다시 인터뷰하다 평론을 못 남긴 상황.
    // 예전 평론 때문에 복구 카드가 묻히면 오늘의 인터뷰가 사라진다.
    results.interviews = { data: [interviewRow()], error: null };
    results.reviews = {
      data: [{ work_id: "work-1", created_at: "2026-08-01T00:00:00Z" }],
      error: null,
    };

    const list = await fetchUnfinishedInterviews("user-1");
    expect(list).toHaveLength(1);
  });

  it("문답이 비어 있으면 복구할 것이 없으므로 제외한다", async () => {
    results.interviews = { data: [interviewRow({ conversation: [] })], error: null };
    results.reviews = { data: [], error: null };

    expect(await fetchUnfinishedInterviews("user-1")).toHaveLength(0);
  });

  it("작품 행이 없으면 제외한다", async () => {
    results.interviews = { data: [interviewRow({ works: null })], error: null };
    results.reviews = { data: [], error: null };

    expect(await fetchUnfinishedInterviews("user-1")).toHaveLength(0);
  });

  it("조회가 실패해도 홈 화면을 막지 않는다 — 빈 배열", async () => {
    results.interviews = { data: null, error: { message: "network" } };

    expect(await fetchUnfinishedInterviews("user-1")).toEqual([]);
  });

  it("후보가 없으면 reviews 를 조회하지 않는다", async () => {
    results.interviews = { data: [], error: null };

    await fetchUnfinishedInterviews("user-1");

    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith("interviews");
  });
});
