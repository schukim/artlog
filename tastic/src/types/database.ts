export type ContentCategory =
  | "movie"
  | "music"
  | "book"
  | "art"
  | "series";

export type InterviewStatus = "in_progress" | "completed" | "abandoned";

export type Language = "ko" | "en";

// developer는 DB에서 직접 부여하는 내부용 플랜 — UI에 노출하지 않음
export type UserPlan = "free" | "membership" | "developer";

export type UsageAction = "review" | "analysis" | "recommendation";

export interface User {
  id: string;
  nickname: string;
  avatar_url: string | null;
  preferred_categories: ContentCategory[];
  language: Language;
  plan: UserPlan;
  created_at: string;
}

export interface UsageLog {
  id: string;
  user_id: string;
  action: UsageAction;
  ref_id: string | null;
  created_at: string;
}

export interface Work {
  id: string;
  user_id: string | null;
  category: ContentCategory;
  title: string;
  original_title: string | null;
  creator: string | null;
  year: number | null;
  genre: string | null;
  title_normalized: string | null;
  metadata: Record<string, unknown>;
  primary_source: string | null;
  contributing_sources: string[];
  external_ids: Record<string, string>;
  last_synced_at: string | null;
  sync_status: string;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

// Content는 Work의 별칭 (네비게이션 파라미터 등 기존 코드 호환)
export type Content = Work;

export interface Review {
  id: string;
  user_id: string;
  work_id: string;
  title: string | null;
  body: string;
  experience_date: string | null;
  created_at: string;
  updated_at: string;
}

export type ReviewFeedbackRating = "up" | "down";
export type ReviewFeedbackReason = "not_mine" | "questions" | "facts" | "tone" | "thin" | "other";

export interface ReviewFeedback {
  id: string;
  review_id: string;
  user_id: string;
  rating: ReviewFeedbackRating;
  reason: ReviewFeedbackReason | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationEntry {
  role: "interviewer" | "user";
  text: string;
  question_type?: "initial" | "deep" | "bridge" | "wide" | "wrap_up";
  topic_label?: string;
}

export interface Interview {
  id: string;
  review_id: string | null;
  user_id: string;
  work_id: string;
  conversation: ConversationEntry[];
  question_count: number;
  status: InterviewStatus;
  created_at: string;
  updated_at: string;
}

export interface TasteProfile {
  id: string;
  user_id: string;
  profile_sentences: string[];
  recommendation_hook: string | null;
  review_count: number;
  created_at: string;
  updated_at: string;
}

export interface Recommendation {
  id: string;
  user_id: string;
  prompt: string | null;
  results: RecommendationItem[];
  created_at: string;
}

export interface RecommendationItem {
  title: string;
  category: ContentCategory;
  creator: string;
  year: number | null;
  reason: string;
  reason_short: string;
  // ── 검증 메타 (서버 검증 파이프라인). 구버전 저장 데이터엔 없을 수 있어 옵셔널 ──
  verified?: boolean;
  source_url?: string | null;
  external_ids?: Record<string, string> | null;
  verification_source?: "cache" | "web";
}

// Supabase 자동 생성 타입 (src/types/supabase.ts, `npm run db:types`)
export type { Database, Json } from "./supabase";
