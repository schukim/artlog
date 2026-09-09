import type { ContentCategory, Content, ConversationEntry } from "./database";

// Root
export type RootStackParamList = {
  Loading: undefined;
  Auth: undefined;
  // 복구 링크로 들어온 세션 위에서만 뜨는 화면이라 Auth 스택이 아닌 최상위에 둔다.
  ResetPassword: undefined;
  ProfileError: undefined;
  Onboarding: undefined;
  IntroTour: undefined;
  Main: undefined;
};

// Auth Stack
export type AuthStackParamList = {
  Login: undefined;
  SignUp: undefined;
  // 로그인 화면에서 입력하던 이메일을 그대로 넘겨 다시 치지 않게 한다.
  ForgotPassword: { email?: string } | undefined;
};

// Main Bottom Tabs
export type MainTabParamList = {
  HistoryTab: undefined;
  RecommendTab: undefined;
  ReviewTab: undefined;
  AnalysisTab: undefined;
  MyTab: undefined;
};

// Review Stack (within ReviewTab)
export type ReviewStackParamList = {
  ReviewHome: undefined;
  ContentConfirm: {
    title: string;
    creator: string;
    category: ContentCategory;
    experienceDate: string;
    musicType?: "album" | "song";
  };
  Interview: {
    content: Content;
  };
  ReviewComplete: {
    content: Content;
    conversation: ConversationEntry[];
    interviewId: string;
    // 미리보기에서 이미 생성한 평론 — 있으면 진입 시 재생성(LLM 재호출)을 건너뛴다
    initialReview?: {
      reviewText: string;
      suggestedTitle: string;
    };
  };
};
