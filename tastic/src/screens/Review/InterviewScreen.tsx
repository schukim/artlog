import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import Animated, {
  FadeInDown,
  SlideInRight,
  FadeIn,
} from "react-native-reanimated";
import type { ReviewStackParamList } from "../../types/navigation";
import type { ConversationEntry } from "../../types/database";
import type { GenerateReviewResponse } from "../../types/llm";
import { QuestionCard } from "../../components/common/QuestionCard";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { CATEGORY_ICONS } from "../../components/common/CategoryChip";
import { useInterview, FREE_MAX_QUESTIONS } from "../../hooks/useInterview";
import { loadDraft, clearDraft } from "../../utils/storage";
import { generateReview } from "../../services/claude";
import { useAuthStore } from "../../stores/authStore";
import { useGuestStore } from "../../stores/guestStore";

type Nav = NativeStackNavigationProp<ReviewStackParamList, "Interview">;
type Route = RouteProp<ReviewStackParamList, "Interview">;

export function InterviewScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const user = useAuthStore((s) => s.user);
  const isGuest = useGuestStore((s) => s.isGuest);
  const { content } = route.params;

  const {
    conversation,
    questionCount,
    isLoading,
    error,
    canPreview,
    isInterviewComplete,
    awaitingChoice,
    interviewId,
    initInterview,
    fetchQuestion,
    submitAnswer,
    continueInterview,
    completeInterview,
    saveDraftNow,
    restoreFromDraft,
    setError,
  } = useInterview(content);

  const [answerText, setAnswerText] = useState("");
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewText, setPreviewText] = useState("");
  // 성공한 미리보기 응답 원본 — '완성하기' 시 ReviewComplete 에 넘겨 재생성을 건너뛴다
  const [previewResult, setPreviewResult] = useState<GenerateReviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const [initialized, setInitialized] = useState(false);
  // 이탈 확인을 통과시킬지(의도된 이동: 종료/저장 후 나가기) 여부
  const allowLeaveRef = useRef(false);
  // beforeRemove 가 막아둔 내비게이션 액션 — 확인 후 재실행
  const pendingActionRef = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);

  // 뒤로가기(하드웨어 백/닫기 버튼)를 가로채 이탈 확인 다이얼로그를 띄운다.
  // 답변이 하나도 없으면 저장할 것이 없으니 그대로 내보낸다.
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (allowLeaveRef.current || isInterviewComplete) return;
      if (!conversation.some((entry) => entry.role === "user")) return;
      e.preventDefault();
      pendingActionRef.current = e.data.action;
      setShowExitDialog(true);
    });
    return unsubscribe;
  }, [navigation, isInterviewComplete, conversation]);

  // Initialize
  useEffect(() => {
    if (initialized) return;
    setInitialized(true);

    (async () => {
      // Check for draft (본인 계정 드래프트만)
      const draft = user ? await loadDraft(user.id) : null;
      if (draft && draft.content.id === content.id) {
        restoreFromDraft(draft.conversation, draft.questionCount, draft.interviewId);
        // If last entry is a user answer, fetch next question
        // (무료 상한 이후는 훅이 플랜에 따라 선택 대기/종료 처리하므로 자동 진행하지 않음)
        const lastEntry = draft.conversation[draft.conversation.length - 1];
        if (lastEntry?.role === "user" && draft.questionCount < FREE_MAX_QUESTIONS) {
          fetchQuestion(draft.conversation, draft.questionCount);
        }
      } else {
        await initInterview();
        fetchQuestion([], 0);
      }
    })();
  }, [initialized, content.id, user, initInterview, fetchQuestion, restoreFromDraft]);

  // 인터뷰 종료(무료 상한 도달, 멤버십 상한/should_end) 시 평론 생성 화면으로 이동
  useEffect(() => {
    if (!isInterviewComplete) return;
    (async () => {
      allowLeaveRef.current = true;
      await completeInterview();
      navigation.replace("ReviewComplete", {
        content,
        conversation,
        interviewId: interviewId ?? "",
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInterviewComplete]);

  const handleSubmitAnswer = async () => {
    if (!answerText.trim()) return;
    const text = answerText.trim();
    setAnswerText("");
    await submitAnswer(text);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const handlePreview = async () => {
    setShowPreview(true);
    setPreviewLoading(true);
    setPreviewResult(null);
    try {
      const result = await generateReview({
        content: {
          title: content.title,
          category: content.category,
          creator: content.creator,
          year: content.year,
          genre: content.genre,
        },
        conversation_history: conversation,
        language: user?.language ?? "ko",
        interview_id: interviewId || null,
        is_preview: true,
      });
      setPreviewText(result?.review_text ?? "");
      if (result?.review_text) setPreviewResult(result);
    } catch (e) {
      // 실패 시 previewResult 는 null 로 남는다 — 에러 문구를 평론으로 넘기지 않기 위함
      setPreviewText(e instanceof Error && e.message ? e.message : t("review.complete.generateFailed"));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleFinish = async () => {
    setShowPreview(false);
    allowLeaveRef.current = true;
    await completeInterview();
    navigation.replace("ReviewComplete", {
      content,
      conversation,
      interviewId: interviewId ?? "",
      // 미리보기로 이미 생성한 평론이 있으면 그대로 사용 (LLM 재호출 방지)
      initialReview: previewResult
        ? {
            reviewText: previewResult.review_text,
            suggestedTitle: previewResult.suggested_title,
          }
        : undefined,
    });
  };

  // 확인 후 실제 이탈 — beforeRemove 가 막아둔 액션이 있으면 그대로 재실행
  const leaveScreen = () => {
    allowLeaveRef.current = true;
    setShowExitDialog(false);
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action) navigation.dispatch(action);
    else navigation.goBack();
  };

  const handleExitSave = async () => {
    await saveDraftNow();
    leaveScreen();
  };

  const handleExitDiscard = async () => {
    // 게스트는 드래프트 자체가 없다 — 지우면 로그아웃 상태로 남아있던 이전 계정의
    // 드래프트를 대신 날려버리므로 건드리지 않는다.
    if (!isGuest) await clearDraft();
    leaveScreen();
  };

  const handleExitCancel = () => {
    pendingActionRef.current = null;
    setShowExitDialog(false);
  };

  // 헤더 표시용 — questionCount(답변 수)가 아닌 실제 받은 질문 수 (첫 질문부터 1)
  const askedCount = conversation.filter((e) => e.role === "interviewer").length;

  // Group conversation for display
  const displayPairs: { question: ConversationEntry; answer?: ConversationEntry }[] = [];
  for (let i = 0; i < conversation.length; i++) {
    const entry = conversation[i];
    if (entry.role === "interviewer") {
      const answer = conversation[i + 1]?.role === "user" ? conversation[i + 1] : undefined;
      displayPairs.push({ question: entry, answer });
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
    <SafeAreaView testID="interview-screen" className="flex-1 bg-surface">
      {/* Header */}
      <View className="px-6 py-3 flex-row items-center justify-between border-b border-surface-tertiary">
        <View className="flex-row items-center flex-1">
          <Text className="text-lg mr-2">{CATEGORY_ICONS[content.category]}</Text>
          <Text className="text-text font-semibold text-base flex-1" numberOfLines={1}>
            {content.title}
          </Text>
        </View>
        <Text className="text-text-secondary text-[15px]">
          {t("review.interview.questionCount", { count: askedCount })}
        </Text>
        {/* 닫기 — 답변이 있으면 beforeRemove 가 이탈 확인 다이얼로그로 가로챈다 */}
        <Pressable
          testID="interview-close-button"
          className="ml-4"
          hitSlop={8}
          onPress={() => navigation.goBack()}
        >
          <Text className="text-text-secondary text-lg">✕</Text>
        </Pressable>
      </View>

      <View className="flex-1">
        {/* Conversation */}
        <ScrollView
          ref={scrollRef}
          className="flex-1 px-6"
          contentContainerClassName="py-4"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {displayPairs.map((pair, idx) => {
            const isTopicShift =
              pair.question.question_type === "wide" ||
              pair.question.question_type === "wrap_up" ||
              pair.question.topic_label !== displayPairs[idx - 1]?.question.topic_label;

            const AnimWrapper = isTopicShift ? SlideInRight : FadeInDown;

            return (
              <Animated.View
                key={idx}
                entering={AnimWrapper.duration(300)}
                className="mb-6"
              >
                <QuestionCard
                  question={pair.question.text}
                  topicLabel={pair.question.topic_label ?? ""}
                  questionNumber={idx + 1}
                  isNewTopic={isTopicShift}
                />
                {pair.answer && (
                  <Animated.View entering={FadeIn.delay(100)} className="mt-3 ml-4">
                    <View className="bg-primary/10 rounded-2xl p-4">
                      <Text className="text-text text-base leading-6">{pair.answer.text}</Text>
                    </View>
                  </Animated.View>
                )}
              </Animated.View>
            );
          })}

          {/* Loading indicator for next question */}
          {isLoading && !showPreview && (
            <View className="items-center py-4">
              <ActivityIndicator size="small" color="#6366F1" />
            </View>
          )}

          {/* Error state */}
          {error === "retry" && (
            <View className="items-center py-4">
              <Text className="text-text-secondary text-[15px] mb-2">
                {t("review.interview.errorLoad")}
              </Text>
              <Pressable
                className="bg-primary/10 px-4 py-2 rounded-full"
                onPress={() => { setError(null); fetchQuestion(conversation, questionCount); }}
              >
                <Text className="text-primary font-medium text-[15px]">
                  {t("review.interview.retry")}
                </Text>
              </Pressable>
            </View>
          )}
          {error === "persist" && (
            <View className="items-center py-4">
              <Text className="text-text-secondary text-[15px] mb-2 text-center">
                {t("review.interview.errorPersist")}
              </Text>
              <Pressable
                className="bg-primary/10 px-4 py-2 rounded-full"
                onPress={() => navigation.goBack()}
              >
                <Text className="text-primary font-medium text-[15px]">
                  {t("review.interview.continueLater")}
                </Text>
              </Pressable>
            </View>
          )}
        </ScrollView>

        {/* Bottom: Answer input + action buttons */}
        <View className="px-6 pb-4 pt-2 border-t border-surface-tertiary">
          {/* 멤버십: 무료 상한 도달 이후 미리보기/계속하기 선택 (무료는 자동 생성·종료) */}
          {awaitingChoice && canPreview && (
            <View className="flex-row mb-3 gap-3">
              <Pressable
                className={`flex-1 rounded-xl py-3 items-center ${previewLoading ? "bg-surface-tertiary/50" : "bg-surface-tertiary"}`}
                onPress={handlePreview}
                disabled={previewLoading}
              >
                <Text className="text-text font-medium text-[15px]">
                  {previewLoading ? "..." : t("review.interview.previewButton")}
                </Text>
              </Pressable>
              <Pressable
                className="flex-1 bg-primary rounded-xl py-3 items-center"
                onPress={continueInterview}
                disabled={isLoading}
              >
                <Text className="text-white font-medium text-[15px]">
                  {t("review.interview.continueButton")}
                </Text>
              </Pressable>
            </View>
          )}

          {/* Answer input — 선택 대기/종료 중에는 숨김 */}
          {!awaitingChoice && !isInterviewComplete && (
            <View className="flex-row items-end">
              <TextInput
                testID="answer-input"
                className="flex-1 bg-surface-secondary border border-surface-tertiary rounded-xl px-4 py-3 text-text text-base mr-3 max-h-24"
                placeholder={t("review.interview.answerPlaceholder")}
                placeholderTextColor="#94A3B8"
                value={answerText}
                onChangeText={setAnswerText}
                multiline
                maxLength={1000}
                editable={!isLoading && !error}
              />
              <Pressable
                testID="submit-answer-button"
                className={`rounded-xl px-5 py-3 ${
                  answerText.trim() && !isLoading ? "bg-primary" : "bg-primary/40"
                }`}
                onPress={handleSubmitAnswer}
                disabled={!answerText.trim() || isLoading}
              >
                <Text className="text-white font-semibold">→</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>

      {/* Preview Modal */}
      {showPreview && (
        <ConfirmDialog
          visible={showPreview}
          title={t("review.interview.previewButton")}
          message={previewText}
          loading={previewLoading}
          actions={[
            { label: t("review.interview.finishFromPreview"), onPress: handleFinish, variant: "primary" },
            { label: t("common.close"), onPress: () => setShowPreview(false) },
          ]}
          onClose={() => setShowPreview(false)}
        />
      )}

      {/* Exit Confirm */}
      <ConfirmDialog
        visible={showExitDialog}
        title={t("review.interview.exitConfirmTitle")}
        message={t("review.interview.exitConfirmMessage")}
        actions={[
          {
            label: t("review.interview.exitConfirmSave"),
            onPress: handleExitSave,
            variant: "primary",
            testID: "interview-exit-save",
          },
          {
            label: t("review.interview.exitConfirmDiscard"),
            onPress: handleExitDiscard,
            variant: "destructive",
            testID: "interview-exit-discard",
          },
          {
            label: t("review.interview.exitConfirmCancel"),
            onPress: handleExitCancel,
            testID: "interview-exit-cancel",
          },
        ]}
        onClose={handleExitCancel}
      />
    </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
