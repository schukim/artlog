// work.ts — findOrCreateWork 재사용 판정 테스트
// 배경(ISSUE-016): 이 함수가 search_works 를 기본 가중치로 불러 점수 상한이 0.40 이었고,
// 재사용 판정선은 0.85 라 한 번도 성립하지 않았다 → 수동입력마다 중복 행이 쌓였다.
// 반대로 근접 유사도로 합치면 속편을 1편으로 흡수한다(실측 0.87). 그래서 재사용 기준은
// "제목 완전일치(trigram 1.0)"다. 이 두 성질을 회귀로 고정한다.
import { describe, it, expect, vi, beforeEach } from "vitest";

import { findOrCreateWork } from "../../services/work";

const { mockRpc, mockFrom, mockSelect, mockEq, mockSingle, mockInsert } = vi.hoisted(() => {
  const mockSingle = vi.fn();
  const mockEq = vi.fn();
  const mockSelect = vi.fn();
  const mockInsert = vi.fn();
  const mockRpc = vi.fn();
  const mockFrom = vi.fn();
  return { mockRpc, mockFrom, mockSelect, mockEq, mockSingle, mockInsert };
});

vi.mock("../../services/supabase", () => ({
  supabase: { rpc: mockRpc, from: mockFrom },
}));

// search_works 가 돌려주는 행 한 줄(필요한 필드만).
function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "work-1",
    title: "Speed Drive",
    is_verified: false,
    primary_source: null,
    similarity_score: 1.0,
    trigram_score: 1.0,
    ...over,
  };
}

const params = { title: "Speed Drive", category: "music" as const };

beforeEach(() => {
  vi.clearAllMocks();
  mockSingle.mockResolvedValue({ data: { id: "work-1", title: "Speed Drive" }, error: null });
  mockEq.mockReturnValue({ single: mockSingle });
  mockSelect.mockReturnValue({ eq: mockEq, single: mockSingle });
  mockInsert.mockReturnValue({ select: mockSelect });
  mockFrom.mockReturnValue({ select: mockSelect, insert: mockInsert });
});

describe("findOrCreateWork", () => {
  it("제목 trigram 유사도만으로 판정되도록 가중치를 넘긴다", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    await findOrCreateWork("user-1", params);

    expect(mockRpc).toHaveBeenCalledWith(
      "search_works",
      expect.objectContaining({ trigram_weight: 1.0, embedding_weight: 0.0 })
    );
  });

  it("제목이 완전히 같은 행이 있으면 재사용하고 새로 만들지 않는다", async () => {
    mockRpc.mockResolvedValue({ data: [row()], error: null });

    const work = await findOrCreateWork("user-1", params);

    expect(work.id).toBe("work-1");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("근접 유사(속편 등)는 재사용하지 않고 새 행을 만든다", async () => {
    // 실측: '악마는 프라다를 입는다' ↔ '악마는 프라다를 입는다 2' = 0.87
    mockRpc.mockResolvedValue({
      data: [row({ id: "work-prequel", is_verified: true, similarity_score: 0.87, trigram_score: 0.87 })],
      error: null,
    });

    await findOrCreateWork("user-1", params);

    expect(mockInsert).toHaveBeenCalled();
  });

  it("완전일치가 여럿이면 신뢰 행을 우선 재사용한다", async () => {
    mockRpc.mockResolvedValue({
      data: [
        row({ id: "work-untrusted" }),
        row({ id: "work-verified", is_verified: true }),
      ],
      error: null,
    });
    mockSingle.mockResolvedValue({ data: { id: "work-verified" }, error: null });

    await findOrCreateWork("user-1", params);

    expect(mockEq).toHaveBeenCalledWith("id", "work-verified");
  });

  it("RPC 가 실패해도 새 행 생성으로 진행한다", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "rpc down" } });

    await findOrCreateWork("user-1", params);

    expect(mockInsert).toHaveBeenCalled();
  });
});
