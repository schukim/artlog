// 미저장 평론 로컬 보관 — 중복 업로드 방지가 핵심.
// 배경: 평론은 화면 진입과 동시에 자동 생성되지만 서버 저장은 '저장하기'를 눌러야 일어난다.
// 그 사이 이탈로 결과물이 통째로 사라지던 것을 막기 위해 생성 직후·이탈 시·저장 실패 시
// 각각 로컬에 보관한다. 단순 push 였다면 같은 평론이 여러 벌 쌓여
// syncUnsavedReviews 가 같은 평론을 여러 편 업로드한다.
import { describe, it, expect, vi, beforeEach } from "vitest";

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  upsertUnsavedReview,
  removeUnsavedReviewFor,
  getUnsavedReviews,
  type UnsavedReview,
} from "../../utils/storage";

// AsyncStorage mock 을 단순 인메모리 저장소로 동작시킨다
let store: Record<string, string>;

beforeEach(() => {
  store = {};
  vi.mocked(AsyncStorage.getItem).mockImplementation(async (k: string) => store[k] ?? null);
  vi.mocked(AsyncStorage.setItem).mockImplementation(async (k: string, v: string) => {
    store[k] = v;
  });
  vi.mocked(AsyncStorage.removeItem).mockImplementation(async (k: string) => {
    delete store[k];
  });
});

function review(over: Partial<UnsavedReview> = {}): UnsavedReview {
  return {
    userId: "user-1",
    contentId: "work-1",
    title: "제목",
    body: "본문",
    experienceDate: null,
    interviewId: "interview-1",
    savedAt: "2026-09-14T00:00:00Z",
    ...over,
  };
}

describe("upsertUnsavedReview", () => {
  it("같은 평론을 여러 번 보관해도 한 건만 남는다", async () => {
    await upsertUnsavedReview(review({ body: "생성 직후" }));
    await upsertUnsavedReview(review({ body: "편집 후 이탈", savedAt: "2026-09-14T00:05:00Z" }));
    await upsertUnsavedReview(review({ body: "저장 실패", savedAt: "2026-09-14T00:09:00Z" }));

    const list = await getUnsavedReviews("user-1");
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe("저장 실패"); // 마지막 내용이 남는다
  });

  it("다른 작품·다른 인터뷰는 별도로 쌓인다", async () => {
    await upsertUnsavedReview(review());
    await upsertUnsavedReview(review({ contentId: "work-2" }));
    await upsertUnsavedReview(review({ interviewId: "interview-2" }));

    expect(await getUnsavedReviews("user-1")).toHaveLength(3);
  });

  it("다른 계정 항목을 건드리지 않는다", async () => {
    await upsertUnsavedReview(review({ userId: "user-2" }));
    await upsertUnsavedReview(review({ body: "내 평론" }));

    const mine = await getUnsavedReviews("user-1");
    const theirs = await getUnsavedReviews("user-2");
    expect(mine).toHaveLength(1);
    expect(mine[0].body).toBe("내 평론");
    expect(theirs).toHaveLength(1);
  });
});

describe("removeUnsavedReviewFor", () => {
  it("서버 저장에 성공한 건만 걷어낸다", async () => {
    await upsertUnsavedReview(review());
    await upsertUnsavedReview(review({ contentId: "work-2" }));

    await removeUnsavedReviewFor("user-1", "work-1", "interview-1");

    const list = await getUnsavedReviews("user-1");
    expect(list).toHaveLength(1);
    expect(list[0].contentId).toBe("work-2");
  });

  it("interviewId 가 비어 있어도(게스트 이관 등) 매칭된다", async () => {
    await upsertUnsavedReview(review({ interviewId: "" }));
    await removeUnsavedReviewFor("user-1", "work-1", "");
    expect(await getUnsavedReviews("user-1")).toHaveLength(0);
  });

  it("다른 계정의 같은 작품은 남긴다", async () => {
    await upsertUnsavedReview(review({ userId: "user-2" }));
    await removeUnsavedReviewFor("user-1", "work-1", "interview-1");
    expect(await getUnsavedReviews("user-2")).toHaveLength(1);
  });
});
