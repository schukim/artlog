import { useState, useCallback, useRef } from "react";
import type { Content, ConversationEntry } from "../types/database";
import type { GenerateQuestionResponse } from "../types/llm";
import { generateQuestion } from "../services/claude";
import { createInterview, updateInterview } from "../services/review";
import { saveDraft } from "../utils/storage";
import { useAuthStore } from "../stores/authStore";
import { getFirstQuestion } from "../prompts/firstQuestions";
import { resolveLlmLanguage } from "../utils/llmLanguage";

const MAX_RETRIES = 3;
// 무료 플랜: 6번째 답변 즉시 평론 자동 생성·세션 종료.
// 5→6: 인터뷰 아크가 심화→전환→심화로 바뀌어(서버 generate-question TURN_ROLE)
// 두 번째 축까지 파려면 6턴이 필요하다. 서버 FREE_MAX_QUESTIONS 와 반드시 일치.
// 멤버십의 '미리보기/계속하기' 분기점도 이 값을 따른다 — 마무리(결) 턴까지 끝난
// 지점이라야 미리보기가 완성된 평론이 된다.
export const FREE_MAX_QUESTIONS = 6;
// 멤버십: 7번째 질문 이상 진행 가능 — 비용 안전 상한만 둠
const MEMBERSHIP_MAX_QUESTIONS = 10;

export function useInterview(content: Content) {
  // 게스트(비로그인 체험)는 user 가 없다 — 인터뷰 행·드래프트를 만드는 지점은 모두
  // !user 로 막혀 있다. 체험 중에는 어떤 유저 데이터도 만들지 않는 것이 원칙이다.
  const user = useAuthStore((s) => s.user);
  // developer는 내부용 플랜 — 기능상 멤버십과 동일하게 동작 (UI 비노출)
  const isMembership = user?.plan === "membership" || user?.plan === "developer";
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [questionCount, setQuestionCount] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState<GenerateQuestionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isInterviewComplete, setIsInterviewComplete] = useState(false);
  // 멤버십: 무료 상한 도달 이후 '미리보기/계속하기' 선택 대기 상태
  const [awaitingChoice, setAwaitingChoice] = useState(false);
  const interviewIdRef = useRef<string | null>(null);

  const canPreview = isMembership && questionCount >= FREE_MAX_QUESTIONS;

  // Initialize interview in DB
  const initInterview = useCallback(async () => {
    if (!user || interviewIdRef.current) return;
    try {
      const interview = await createInterview({
        userId: user.id,
        workId: content.id,
      });
      interviewIdRef.current = interview.id;
    } catch {
      // Non-blocking: interview will be created on first save
    }
  }, [user, content.id]);

  // Fetch next question — first question is always from the predefined list
  const fetchQuestion = useCallback(async (conv: ConversationEntry[], qCount: number) => {
    setIsLoading(true);
    setError(null);
    try {
      let response: GenerateQuestionResponse;
      // 게스트는 계정(users.language)이 없어 기기 언어를 따른다 — utils/llmLanguage.ts
      const language = resolveLlmLanguage(user);

      if (qCount === 0) {
        // First question: pick from predefined category-specific list
        const question = getFirstQuestion(content.category, content.metadata, language);
        response = {
          question,
          question_type: "initial",
          topic_label: language === "en" ? "First impression" : "첫인상",
        };
      } else {
        response = await generateQuestion({
          content: {
            title: content.title,
            category: content.category,
            creator: content.creator,
            year: content.year,
            genre: content.genre,
            metadata: content.metadata,
          },
          conversation_history: conv,
          question_count: qCount,
          language,
        });
      }

      // Only honor should_end after the user has answered the free-plan quota
      if (response.should_end && qCount >= FREE_MAX_QUESTIONS) {
        setIsInterviewComplete(true);
        setRetryCount(0);
        return response;
      }

      setCurrentQuestion(response);
      setRetryCount(0);

      // Add question to conversation
      const questionEntry: ConversationEntry = {
        role: "interviewer",
        text: response.question,
        question_type: response.question_type,
        topic_label: response.topic_label,
      };
      const updated = [...conv, questionEntry];
      setConversation(updated);

      return response;
    } catch {
      const newRetryCount = retryCount + 1;
      setRetryCount(newRetryCount);
      setError(newRetryCount >= MAX_RETRIES ? "persist" : "retry");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [content, user, retryCount]);

  // Submit answer and get next question
  const submitAnswer = useCallback(async (answerText: string) => {
    const answerEntry: ConversationEntry = { role: "user", text: answerText };
    const updatedConv = [...conversation, answerEntry];
    const newCount = questionCount + 1;

    setConversation(updatedConv);
    setQuestionCount(newCount);

    // Sync to DB
    if (interviewIdRef.current) {
      updateInterview(interviewIdRef.current, updatedConv, newCount).catch(() => {});
    }

    // 플랜별 상한: 무료는 상한 도달 시 즉시 종료, 멤버십은 안전 상한까지
    const maxQuestions = isMembership ? MEMBERSHIP_MAX_QUESTIONS : FREE_MAX_QUESTIONS;
    if (newCount >= maxQuestions) {
      setIsInterviewComplete(true);
      return null;
    }

    // Auto-save draft (계정 스코프 — 계정 전환 시 노출/오업로드 방지)
    if (user) {
      await saveDraft({
        userId: user.id,
        content,
        conversation: updatedConv,
        questionCount: newCount,
        interviewId: interviewIdRef.current,
        savedAt: new Date().toISOString(),
      });
    }

    // 멤버십: 무료 상한부터는 자동 진행하지 않고 미리보기/계속하기 선택을 기다린다
    if (isMembership && newCount >= FREE_MAX_QUESTIONS) {
      setAwaitingChoice(true);
      return null;
    }

    // Fetch next question
    return fetchQuestion(updatedConv, newCount);
  }, [conversation, questionCount, content, fetchQuestion, isMembership]);

  // 멤버십: '인터뷰 계속하기' — 다음 질문 요청
  const continueInterview = useCallback(async () => {
    setAwaitingChoice(false);
    return fetchQuestion(conversation, questionCount);
  }, [conversation, questionCount, fetchQuestion]);

  // 이탈("저장하고 나가기") 시 현재 상태를 드래프트로 저장.
  // submitAnswer 의 자동 저장과 달리 답변 전(질문만 있는) 상태도 저장한다.
  const saveDraftNow = useCallback(async () => {
    if (!user) return;
    await saveDraft({
      userId: user.id,
      content,
      conversation,
      questionCount,
      interviewId: interviewIdRef.current,
      savedAt: new Date().toISOString(),
    });
  }, [user, content, conversation, questionCount]);

  // 인터뷰 종료 처리 — 평론 생성은 ReviewCompleteScreen에서 수행
  //
  // 드래프트는 여기서 지우지 않는다. 예전엔 인터뷰를 마치는 순간 지웠는데, 평론 생성은
  // 그다음 화면에서 일어나므로 생성이 실패하면 사용자가 돌아갈 곳이 사라졌다 —
  // 문답은 서버 interviews 행에 남지만 그것을 다시 열어주는 화면이 없어서, 20분짜리
  // 인터뷰를 처음부터 다시 해야 했다(실측 1건). 이제 평론이 서버에 저장된 뒤
  // ReviewCompleteScreen 에서 지운다.
  const completeInterview = useCallback(async () => {
    setAwaitingChoice(false);
    if (interviewIdRef.current) {
      updateInterview(interviewIdRef.current, conversation, questionCount, "completed").catch(() => {});
    }
  }, [conversation, questionCount]);

  // Restore from draft
  const restoreFromDraft = useCallback((
    savedConversation: ConversationEntry[],
    savedQuestionCount: number,
    savedInterviewId: string | null
  ) => {
    setConversation(savedConversation);
    setQuestionCount(savedQuestionCount);
    interviewIdRef.current = savedInterviewId;

    // Find last question in conversation
    const lastQuestion = [...savedConversation]
      .reverse()
      .find((e) => e.role === "interviewer");

    if (lastQuestion) {
      setCurrentQuestion({
        question: lastQuestion.text,
        question_type: lastQuestion.question_type ?? "deep",
        topic_label: lastQuestion.topic_label ?? "",
      });
    }

    // 무료 상한 이후 답변까지 마친 드래프트 복원: 플랜에 따라 선택 대기 / 즉시 종료
    const lastEntry = savedConversation[savedConversation.length - 1];
    if (lastEntry?.role === "user" && savedQuestionCount >= FREE_MAX_QUESTIONS) {
      if (isMembership && savedQuestionCount < MEMBERSHIP_MAX_QUESTIONS) {
        setAwaitingChoice(true);
      } else {
        setIsInterviewComplete(true);
      }
    }
  }, [isMembership]);

  return {
    conversation,
    questionCount,
    currentQuestion,
    isLoading,
    error,
    canPreview,
    isInterviewComplete,
    awaitingChoice,
    isMembership,
    interviewId: interviewIdRef.current,
    initInterview,
    fetchQuestion,
    submitAnswer,
    continueInterview,
    completeInterview,
    saveDraftNow,
    restoreFromDraft,
    setError,
  };
}
