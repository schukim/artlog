import type { Review, Interview, ConversationEntry, Work } from "../types/database";
import type { Json } from "../types/supabase";
import { supabase } from "./supabase";
import { getUnsavedReviews, removeUnsavedReview } from "../utils/storage";

// ── Reviews ──

interface CreateReviewParams {
  userId: string;
  workId: string;
  title: string | null;
  body: string;
  experienceDate: string | null;
}

export async function createReview(params: CreateReviewParams): Promise<Review> {
  const { data, error } = await supabase
    .from("reviews")
    .insert({
      user_id: params.userId,
      work_id: params.workId,
      title: params.title,
      body: params.body,
      experience_date: params.experienceDate,
    })
    .select()
    .single();

  if (error) {
    console.error("createReview error:", error);
    throw new Error(`평론 저장에 실패했습니다: ${error.message}`);
  }

  // DB row(work_id nullable 등)를 좁은 도메인 타입으로 신뢰 변환
  return data as unknown as Review;
}

export interface ReviewWithContent extends Review {
  works: {
    id: string;
    title: string;
    category: string;
    creator: string | null;
    year: number | null;
  } | null;
}

// 저장 실패로 로컬(AsyncStorage)에 보관된 평론을 서버로 재업로드한다.
// 앱 시작(로그인 확인 후)과 히스토리 진입 시 호출 — 성공한 건만 로컬에서 제거하고,
// 실패한 건 다음 기회에 재시도한다.
let isSyncingUnsaved = false;

export async function syncUnsavedReviews(userId: string): Promise<void> {
  if (isSyncingUnsaved) return;
  isSyncingUnsaved = true;
  try {
    // 본인(userId) 항목만 — 계정 전환 시 타 계정 평론이 업로드되는 것 방지
    const pending = await getUnsavedReviews(userId);
    for (const item of pending) {
      try {
        const review = await createReview({
          userId,
          workId: item.contentId,
          title: item.title,
          body: item.body,
          experienceDate: item.experienceDate,
        });
        if (item.interviewId) {
          await linkInterviewToReview(item.interviewId, review.id).catch(() => {});
        }
        await removeUnsavedReview(item.savedAt);
      } catch {
        // 여전히 실패 — 로컬에 남겨두고 다음 동기화 때 재시도
      }
    }
  } finally {
    isSyncingUnsaved = false;
  }
}

export async function fetchReviews(userId: string): Promise<ReviewWithContent[]> {
  const { data, error } = await supabase
    .from("reviews")
    .select("*, works(id, title, category, creator, year)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("fetchReviews error:", error);
    throw new Error(`평론 조회에 실패했습니다: ${error.message}`);
  }

  return (data ?? []) as ReviewWithContent[];
}

export async function fetchReviewsByMonth(
  userId: string,
  year: number,
  month: number
): Promise<ReviewWithContent[]> {
  const startDate = new Date(year, month - 1, 1).toISOString();
  const endDate = new Date(year, month, 0, 23, 59, 59, 999).toISOString();

  const { data, error } = await supabase
    .from("reviews")
    .select("*, works(id, title, category, creator, year)")
    .eq("user_id", userId)
    .gte("created_at", startDate)
    .lte("created_at", endDate)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("fetchReviewsByMonth error:", error);
    throw new Error(`월별 평론 조회에 실패했습니다: ${error.message}`);
  }

  return (data ?? []) as ReviewWithContent[];
}

export async function deleteReview(reviewId: string): Promise<void> {
  const { error } = await supabase
    .from("reviews")
    .delete()
    .eq("id", reviewId);

  if (error) {
    console.error("deleteReview error:", error);
    throw new Error(`평론 삭제에 실패했습니다: ${error.message}`);
  }
}

export async function updateReview(reviewId: string, body: string, title?: string): Promise<Review> {
  const updateData: Partial<Review> = { body };
  if (title !== undefined) updateData.title = title;

  const { data, error } = await supabase
    .from("reviews")
    .update(updateData)
    .eq("id", reviewId)
    .select()
    .single();

  if (error) {
    console.error("updateReview error:", error);
    throw new Error(`평론 수정에 실패했습니다: ${error.message}`);
  }

  return data as unknown as Review;
}

// ── Interviews ──

interface CreateInterviewParams {
  userId: string;
  workId: string;
}

export async function createInterview(params: CreateInterviewParams): Promise<Interview> {
  const { data, error } = await supabase
    .from("interviews")
    .insert({
      user_id: params.userId,
      work_id: params.workId,
      conversation: [],
      question_count: 0,
      status: "in_progress",
    })
    .select()
    .single();

  if (error) {
    console.error("createInterview error:", error);
    throw new Error(`인터뷰 생성에 실패했습니다: ${error.message}`);
  }

  return data as unknown as Interview;
}

// 인터뷰는 끝냈는데 평론이 남지 않은 건 — 홈에서 복구 진입점으로 노출한다.
//
// 왜 필요한가: 평론은 ReviewCompleteScreen 에서 생성되고 '저장하기'를 눌러야 서버에 남는다.
// 생성이 실패하거나 저장 전에 이탈하면 문답은 이 테이블에 남지만 그것을 여는 화면이 없어,
// 10~20분짜리 인터뷰가 사용자에게서 사라진 것과 같았다(실측 4건).
// 로컬 드래프트로도 복구되지만 그건 같은 기기·7일 한정이라, 서버 기준 경로를 따로 둔다.
export interface UnfinishedInterview {
  id: string;
  work: Work;
  conversation: ConversationEntry[];
  createdAt: string;
}

export async function fetchUnfinishedInterviews(userId: string): Promise<UnfinishedInterview[]> {
  const { data, error } = await supabase
    .from("interviews")
    .select("id, work_id, conversation, created_at, works(*)")
    .eq("user_id", userId)
    .eq("status", "completed")
    .is("review_id", null)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error("fetchUnfinishedInterviews error:", error);
    return [];
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    work_id: string;
    conversation: ConversationEntry[] | null;
    created_at: string;
    works: Work | null;
  }[];
  const candidates = rows.filter((r) => r.works && (r.conversation?.length ?? 0) > 0);
  if (candidates.length === 0) return [];

  // review_id 연결이 실패했을 뿐 평론은 이미 있는 경우를 걸러낸다
  // (linkInterviewToReview 는 실패해도 저장을 막지 않는 보조 호출이다).
  const { data: existing } = await supabase
    .from("reviews")
    .select("work_id")
    .eq("user_id", userId)
    .in("work_id", candidates.map((r) => r.work_id));
  const reviewed = new Set((existing ?? []).map((r) => r.work_id));

  return candidates
    .filter((r) => !reviewed.has(r.work_id))
    .map((r) => ({
      id: r.id,
      work: r.works as Work,
      conversation: r.conversation ?? [],
      createdAt: r.created_at,
    }));
}

// 복구 카드에서 '지우기' — 평론 없이 끝난 인터뷰를 더 이상 노출하지 않는다.
// 문답 자체는 남겨둔다(되돌릴 수 없는 삭제를 카드 한 번 눌러 일으키지 않는다).
export async function abandonInterview(interviewId: string): Promise<void> {
  const { error } = await supabase
    .from("interviews")
    .update({ status: "abandoned" })
    .eq("id", interviewId);
  if (error) {
    console.error("abandonInterview error:", error);
    throw new Error(`인터뷰 정리에 실패했습니다: ${error.message}`);
  }
}

export async function updateInterview(
  interviewId: string,
  conversation: ConversationEntry[],
  questionCount: number,
  status?: "in_progress" | "completed" | "abandoned"
): Promise<void> {
  const { error } = await supabase
    .from("interviews")
    .update({
      // conversation 컬럼은 jsonb
      conversation: conversation as unknown as Json,
      question_count: questionCount,
      ...(status ? { status } : {}),
    })
    .eq("id", interviewId);

  if (error) {
    console.error("updateInterview error:", error);
    throw new Error(`인터뷰 업데이트에 실패했습니다: ${error.message}`);
  }
}

export async function linkInterviewToReview(interviewId: string, reviewId: string): Promise<void> {
  const { error } = await supabase
    .from("interviews")
    .update({ review_id: reviewId })
    .eq("id", interviewId);

  if (error) {
    console.error("linkInterviewToReview error:", error);
    throw new Error(`인터뷰와 평론 연결에 실패했습니다: ${error.message}`);
  }
}
