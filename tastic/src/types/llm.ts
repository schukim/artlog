import type { ContentCategory, ConversationEntry } from "./database";

// ── verify-content ──
export interface VerifyContentRequest {
  title: string;
  creator?: string;
  category: ContentCategory;
  language: "ko" | "en";
  // true면 글로벌 캐시를 건너뛰고 웹서치 강제('재검색' 버튼)
  skipCache?: boolean;
  // true면 서버가 별칭(원제) 해석 패스를 강제한다. 재검색이 매번 같은 결과를 내지 않도록
  // 하는 장치 — 1패스가 후보를 찾았더라도 원제로 다시 훑는다.
  retry?: boolean;
}

export interface ContentCandidate {
  title: string;
  original_title: string | null;
  creator: string | null;
  year: number | null;
  genre: string | null;
  metadata: Record<string, unknown>;
  confidence: "high" | "medium" | "low";
}

// verify-content 엣지 함수가 응답에 싣는 웹서치 탐색 트레이스(디버그용).
// 모델이 실제 인용한 출처/검색 횟수 등을 담는다.
export interface VerifyContentDebug {
  // 캐시 히트 여부 — '재검색' 버튼 노출 판단에 사용
  cache_hit?: boolean;
  // 확정이 아니라 제안(유사도 0.75~0.85)인 캐시 히트. 화면에 "이 작품이 맞나요?"를 띄운다.
  suggested?: boolean;
  // 별칭(사람이 확정해 만든 "이 문자열 = 이 작품" 연결)으로 잡힌 히트
  alias_hit?: boolean;
  // 질의 메모 캐시로 잡힌 히트
  memo_hit?: boolean;
  source_work_id?: string;
  similarity?: number;
  ms: number;
  search_count: number;
  cited_domains: string[];
  citations?: { url: string; title: string | null }[];
  status?: string | null;
  incomplete_reason?: string | null;
  format_status?: string | null;
  // 별칭(원제) 해석 패스가 실행됐는지와, 찾아낸 다른 표기들
  alias_attempted?: boolean;
  aliases?: string[];
  // 별칭 패스 결과 — 반영됨/불필요/예산부족/타임아웃/별칭없음/후보없음
  alias_outcome?:
    | "not_needed"
    | "no_budget"
    | "timeout"
    | "no_aliases"
    | "no_result"
    | "applied";
}

export interface VerifyContentResponse {
  candidates: ContentCandidate[];
  _debug?: VerifyContentDebug;
}

// ── generate-question ──
export interface GenerateQuestionRequest {
  content: {
    title: string;
    category: ContentCategory;
    creator: string | null;
    year: number | null;
    genre: string | null;
    metadata: Record<string, unknown>;
  };
  conversation_history: ConversationEntry[];
  question_count: number;
  language: "ko" | "en";
}

export interface GenerateQuestionResponse {
  question: string;
  question_type: "initial" | "deep" | "bridge" | "wide" | "wrap_up";
  topic_label: string;
  should_end?: boolean;
}

// ── generate-review ──
export interface GenerateReviewRequest {
  content: {
    title: string;
    category: ContentCategory;
    creator: string | null;
    year: number | null;
    genre: string | null;
  };
  conversation_history: ConversationEntry[];
  language: "ko" | "en";
  // 사용량 카운트 멱등 처리용 — 같은 인터뷰의 재생성은 중복 카운트하지 않음
  interview_id?: string | null;
  // true면 멤버십 전용 미리보기 (사용량 미차감)
  is_preview?: boolean;
}

export interface GenerateReviewResponse {
  // 평론이 사용자의 감상을 어떻게 규정했는지 한 문장 — 서버가 논지 우선 생성
  // (나열 방지)을 위해 본문보다 먼저 생성한다. 클라이언트 표시용은 아니며,
  // 추후 취향 분석 재료로 활용 가능. 구버전 응답 호환을 위해 optional.
  thesis?: string;
  review_text: string;
  suggested_title: string;
}

// ── analyze-taste ──
// reviews·previous_profile 은 서버가 인증 사용자의 DB 데이터로 직접 조회한다(전송 불필요).
export interface AnalyzeTasteRequest {
  language: "ko" | "en";
}

export interface AnalyzeTasteResponse {
  profile_sentences: string[];
  recommendation_hook: string;
}

// ── recommend-content ──
// taste_profile·review_history 는 서버가 인증 사용자의 DB 데이터로 직접 조회한다(전송 불필요).
export interface RecommendContentRequest {
  user_prompt: string;
  language: "ko" | "en";
}

export interface RecommendContentResponse {
  recommendations: {
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
  }[];
}

// ── 공통 에러 ──
export interface LLMErrorResponse {
  error: string;
  message: string;
}
