import type { ReviewFeedback, ReviewFeedbackRating, ReviewFeedbackReason } from "../types/database";
import { supabase } from "./supabase";

interface SubmitReviewFeedbackParams {
  reviewId: string;
  userId: string;
  rating: ReviewFeedbackRating;
  reason?: ReviewFeedbackReason | null;
  comment?: string | null;
}

// 1인 1평론 1건 — 같은 (review_id, user_id) 재제출은 갱신된다(unique 제약 + upsert).
export async function submitReviewFeedback(params: SubmitReviewFeedbackParams): Promise<ReviewFeedback> {
  const isUp = params.rating === "up";
  const { data, error } = await supabase
    .from("review_feedback")
    .upsert(
      {
        review_id: params.reviewId,
        user_id: params.userId,
        rating: params.rating,
        // up 은 이유·코멘트를 남기지 않는다 (DB check 제약과도 일치)
        reason: isUp ? null : params.reason ?? null,
        comment: isUp ? null : params.comment?.trim() || null,
      },
      { onConflict: "review_id,user_id" }
    )
    .select()
    .single();

  if (error) {
    console.error("submitReviewFeedback error:", error);
    throw new Error(`피드백 저장에 실패했습니다: ${error.message}`);
  }

  return data as unknown as ReviewFeedback;
}
