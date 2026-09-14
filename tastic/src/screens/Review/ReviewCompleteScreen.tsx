import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { ReviewStackParamList } from "../../types/navigation";
import { generateReview } from "../../services/claude";
import { createReview, linkInterviewToReview } from "../../services/review";
import { upsertUnsavedReview, removeUnsavedReviewFor, clearDraft } from "../../utils/storage";
import { markGuestInterviewUsed, saveGuestPendingReview } from "../../utils/guestStorage";
import { resolveLlmLanguage } from "../../utils/llmLanguage";
import { CATEGORY_ICONS } from "../../components/common/CategoryChip";
import { GuestSignInDialog } from "../../components/common/GuestSignInDialog";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { useAuthStore } from "../../stores/authStore";
import { useGuestStore } from "../../stores/guestStore";

type Nav = NativeStackNavigationProp<ReviewStackParamList, "ReviewComplete">;
type Route = RouteProp<ReviewStackParamList, "ReviewComplete">;

export function ReviewCompleteScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const user = useAuthStore((s) => s.user);
  const isGuest = useGuestStore((s) => s.isGuest);
  const guestPendingWork = useGuestStore((s) => s.pendingWork);
  const setGuestInterviewUsed = useGuestStore((s) => s.setInterviewUsed);
  const setHasPendingReview = useGuestStore((s) => s.setHasPendingReview);

  const { content, conversation, interviewId, initialReview } = route.params;

  const [reviewText, setReviewText] = useState(initialReview?.reviewText ?? "");
  const [reviewTitle, setReviewTitle] = useState(initialReview?.suggestedTitle ?? "");
  const [isGenerating, setIsGenerating] = useState(!initialReview);
  const [isSaving, setIsSaving] = useState(false);
  const [generateError, setGenerateError] = useState(false);
  const [generateErrorMessage, setGenerateErrorMessage] = useState<string | null>(null);
  // saved: 서버 저장 성공 / queued: 실패해 로컬 보관 (연결 시 syncUnsavedReviews 가 업로드)
  const [saveResult, setSaveResult] = useState<"saved" | "queued" | null>(null);
  // 게스트가 '저장하기'를 눌렀을 때의 로그인 유도 모달
  const [showGuestSaveDialog, setShowGuestSaveDialog] = useState(false);
  // 서버 저장에 성공했는지 — 성공 후에는 로컬 보관본을 다시 만들지 않는다.
  const savedRef = useRef(false);
  // 사용자가 '저장하지 않고 나가기'를 고른 경우 — 보관본을 되살리지 않는다.
  const discardedRef = useRef(false);
  // 언마운트 시점에 화면의 최신 텍스트(사용자 편집분 포함)를 읽기 위한 참조.
  const latestRef = useRef({ title: "", body: "" });
  useEffect(() => {
    latestRef.current = { title: reviewTitle, body: reviewText };
  }, [reviewTitle, reviewText]);

  // 로그인 사용자의 평론을 기기에 보관한다.
  //
  // 왜: 평론은 화면 진입과 동시에 자동 생성되지만 서버 저장은 '저장하기'를 눌러야 일어난다.
  // 그 사이에 화면을 벗어나면 10~20분짜리 인터뷰 결과가 통째로 사라졌다 —
  // 실측으로 완료된 인터뷰 62건 중 4건이 평론 없이 끝났고, 그중 3건은 생성까지 됐던 건이다.
  // (게스트는 persistGuestReview 로 이미 보호받고 있었다. 가입한 쪽이 덜 보호받던 셈.)
  // 보관분은 다음 실행 때 syncUnsavedReviews 가 서버로 올린다.
  const persistLocalReview = async (title: string, body: string) => {
    if (isGuest || !user || !body.trim() || savedRef.current || discardedRef.current) return;
    try {
      await upsertUnsavedReview({
        userId: user.id,
        contentId: content.id,
        title: title || null,
        body,
        experienceDate: null,
        interviewId,
        savedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error("persistLocalReview failed:", e);
    }
  };

  // 화면을 벗어날 때 편집분까지 보관 — 저장에 성공했다면 savedRef 가 막는다.
  useEffect(() => {
    return () => {
      void persistLocalReview(latestRef.current.title, latestRef.current.body);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 이탈 확인 ──
  // 로컬 보관이 평론을 지켜주지만, 사용자 입장에서는 "저장하기를 안 눌렀는데 나가도 되나"가
  // 보이지 않는다. 인터뷰 화면과 같은 방식으로 한 번 물어본다.
  // 저장에 성공했거나(savedRef) 아직 생성 전이면 막지 않는다.
  const allowLeaveRef = useRef(false);
  const pendingActionRef = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);
  const [showExitDialog, setShowExitDialog] = useState(false);

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (allowLeaveRef.current || savedRef.current) return;
      if (!latestRef.current.body.trim()) return;
      e.preventDefault();
      pendingActionRef.current = e.data.action;
      setShowExitDialog(true);
    });
    return unsubscribe;
  }, [navigation]);

  const leaveScreen = () => {
    allowLeaveRef.current = true;
    setShowExitDialog(false);
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action) navigation.dispatch(action);
    else navigation.goBack();
  };

  const handleExitSave = async () => {
    setShowExitDialog(false);
    await handleSave();
    // handleSave 가 성공하면 자체적으로 홈으로 돌아간다(popToTop).
    // 실패해도 로컬 보관(queued)까지 끝난 상태이므로 그대로 내보낸다.
    if (!savedRef.current) leaveScreen();
  };

  const handleExitDiscard = async () => {
    // 사용자가 "저장하지 않겠다"를 명시적으로 고른 경우다. 로컬 보관본도 함께 걷어낸다 —
    // 남겨두면 다음 실행 때 syncUnsavedReviews 가 올려버려 버튼 문구와 어긋난다.
    discardedRef.current = true;
    if (user && !isGuest) {
      await removeUnsavedReviewFor(user.id, content.id, interviewId).catch(() => {});
    }
    leaveScreen();
  };

  const handleExitCancel = () => {
    pendingActionRef.current = null;
    setShowExitDialog(false);
  };

  useEffect(() => {
    // 미리보기에서 이미 생성한 평론을 받았으면 재생성(LLM 재호출)하지 않는다
    if (!initialReview) handleGenerate();
    if (isGuest && initialReview) {
      consumeGuestTrial();
      void persistGuestReview(initialReview.suggestedTitle, initialReview.reviewText);
    }
    // 미리보기에서 완성된 평론을 들고 들어온 경우도 즉시 보관한다 —
    // 언마운트를 기다리면 앱이 강제 종료될 때 그대로 사라진다.
    if (initialReview) {
      void persistLocalReview(initialReview.suggestedTitle, initialReview.reviewText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 게스트 체험 1회를 소진 처리한다. 인터뷰 완료가 아니라 "평론이 실제로 생성된"
  // 시점에 건다 — 생성이 실패했는데 체험만 날아가면 아무것도 못 본 채로 막히기 때문.
  const consumeGuestTrial = () => {
    if (!isGuest) return;
    setGuestInterviewUsed(true);
    markGuestInterviewUsed().catch(() => {});
  };

  // 게스트가 만든 평론을 로컬에 보관한다. '저장하기'를 누르지 않고 화면을 벗어나도
  // 애써 만든 평론이 사라지지 않도록 생성 직후와 저장 시도 시점 모두에서 기록한다.
  const persistGuestReview = async (title: string, body: string) => {
    if (!isGuest || !guestPendingWork || !body.trim()) return;
    try {
      await saveGuestPendingReview({
        work: guestPendingWork,
        conversation,
        title: title || null,
        body,
        savedAt: new Date().toISOString(),
      });
      setHasPendingReview(true);
    } catch (e) {
      console.error("saveGuestPendingReview failed:", e);
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGenerateError(false);
    setGenerateErrorMessage(null);
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
        // 게스트는 계정(users.language)이 없어 기기 언어를 따른다 — utils/llmLanguage.ts
        language: resolveLlmLanguage(user),
        // 같은 인터뷰의 재생성은 사용량을 추가 차감하지 않도록 서버에 전달
        interview_id: interviewId || null,
      });
      if (result) {
        setReviewText(result.review_text);
        setReviewTitle(result.suggested_title);
        consumeGuestTrial();
        void persistGuestReview(result.suggested_title, result.review_text);
        // 생성 즉시 보관 — 여기서부터는 화면을 어떻게 벗어나도 평론이 남는다.
        void persistLocalReview(result.suggested_title, result.review_text);
      } else {
        setGenerateError(true);
      }
    } catch (e) {
      // 서버 한도 초과(limit_exceeded) 등의 메시지는 그대로 노출
      setGenerateErrorMessage(e instanceof Error && e.message ? e.message : null);
      setGenerateError(true);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!reviewText.trim()) return;

    // 게스트: 저장은 계정 기반 행위다. 편집분까지 로컬에 보관한 뒤 회원가입을 안내한다.
    // 가입이 완료되면 useAuth → migrateGuestReview 가 이 평론을 새 계정으로 옮긴다.
    if (isGuest) {
      await persistGuestReview(reviewTitle, reviewText);
      setShowGuestSaveDialog(true);
      return;
    }

    if (!user) return;
    setIsSaving(true);
    try {
      const review = await createReview({
        userId: user.id,
        workId: content.id,
        title: reviewTitle || null,
        body: reviewText,
        experienceDate: null,
      });

      if (interviewId) {
        await linkInterviewToReview(interviewId, review.id);
      }

      // 여기까지 와야 평론이 안전하다. 로컬 보관본과 인터뷰 드래프트를 이제 걷어낸다
      // — 드래프트는 예전엔 인터뷰를 마치는 순간 지웠는데, 그러면 평론 생성이 실패했을 때
      //   사용자가 돌아갈 곳이 사라졌다(실측 1건).
      savedRef.current = true;
      await removeUnsavedReviewFor(user.id, content.id, interviewId);
      await clearDraft();

      setSaveResult("saved");
      setTimeout(() => navigation.popToTop(), 1500);
    } catch {
      // 서버 저장 실패 — 로컬 보관 후 연결되면 syncUnsavedReviews 가 자동 업로드
      await upsertUnsavedReview({
        userId: user.id,
        contentId: content.id,
        title: reviewTitle || null,
        body: reviewText,
        experienceDate: null,
        interviewId,
        savedAt: new Date().toISOString(),
      });
      setSaveResult("queued");
      // 임시 저장 안내는 읽을 시간을 조금 더 준다
      setTimeout(() => navigation.popToTop(), 2200);
    } finally {
      setIsSaving(false);
    }
  };

  // Loading state
  if (isGenerating) {
    return (
      <SafeAreaView className="flex-1 bg-surface justify-center items-center">
        <ActivityIndicator size="large" color="#6366F1" />
        <Text className="text-text-secondary text-base mt-4">
          {t("review.complete.generating")}
        </Text>
      </SafeAreaView>
    );
  }

  // Error state
  if (generateError) {
    return (
      <SafeAreaView className="flex-1 bg-surface justify-center items-center px-6">
        <Text className="text-text-secondary text-base text-center mb-4">
          {generateErrorMessage ?? t("review.complete.generateFailed")}
        </Text>
        <View className="flex-row gap-3">
          <Pressable
            className="bg-primary rounded-xl px-6 py-3"
            onPress={handleGenerate}
          >
            <Text className="text-white font-medium">{t("review.complete.regenerate")}</Text>
          </Pressable>
          {/* Interview 는 replace 로 스택에서 제거된 상태라 goBack 하면 작품 확인 화면으로
              떨어진다(드래프트도 이미 삭제됨) — 홈으로 보내는 게 정직한 동작 */}
          <Pressable
            className="bg-surface-tertiary rounded-xl px-6 py-3"
            onPress={() => navigation.popToTop()}
          >
            <Text className="text-text font-medium">{t("review.complete.goHome")}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Save result toast — 서버 저장(saved)과 로컬 임시 저장(queued)을 구분해 안내
  if (saveResult) {
    return (
      <SafeAreaView className="flex-1 bg-surface justify-center items-center px-8">
        {saveResult === "saved" ? (
          <View className="bg-success/10 rounded-2xl p-8 items-center">
            <Text className="text-success text-4xl mb-4">✓</Text>
            <Text className="text-text text-lg font-semibold">{t("review.complete.saved")}</Text>
          </View>
        ) : (
          <View className="bg-surface-tertiary rounded-2xl p-8 items-center">
            <Text className="text-4xl mb-4">☁️</Text>
            <Text className="text-text text-lg font-semibold mb-2">{t("review.complete.queued")}</Text>
            <Text className="text-text-secondary text-[15px] text-center">
              {t("review.complete.queuedDesc")}
            </Text>
          </View>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <ScrollView className="flex-1 px-6 pt-6" contentContainerClassName="pb-8">
        {/* Header */}
        <View className="flex-row items-center mb-6">
          <Text className="text-lg mr-2">{CATEGORY_ICONS[content.category]}</Text>
          <Text className="text-text font-semibold text-base flex-1" numberOfLines={1}>
            {content.title}
          </Text>
          <Text className="text-text-secondary text-[15px]">{t("review.complete.title")}</Text>
        </View>

        {/* Review title */}
        <TextInput
          className="text-text text-xl font-bold mb-4"
          value={reviewTitle}
          onChangeText={setReviewTitle}
          placeholder={t("review.complete.titlePlaceholder")}
          placeholderTextColor="#94A3B8"
        />

        {/* Review body */}
        <TextInput
          className="text-text text-base leading-7 min-h-[300px]"
          value={reviewText}
          onChangeText={setReviewText}
          multiline
          textAlignVertical="top"
        />

        {/* Character count */}
        <Text className="text-text-tertiary text-[13px] text-right mt-2">
          {reviewText.length}
        </Text>
      </ScrollView>

      {/* Bottom buttons */}
      <View className="px-6 pb-6 flex-row gap-3">
        <Pressable
          className="flex-1 bg-surface-tertiary rounded-xl py-4 items-center"
          onPress={handleGenerate}
          disabled={isGenerating}
        >
          <Text className="text-text font-semibold text-base">
            {t("review.complete.regenerate")}
          </Text>
        </Pressable>
        <Pressable
          className={`flex-1 rounded-xl py-4 items-center ${
            reviewText.trim() && !isSaving ? "bg-primary" : "bg-primary/40"
          }`}
          onPress={handleSave}
          disabled={!reviewText.trim() || isSaving}
        >
          <Text className="text-white font-semibold text-base">
            {isSaving ? "..." : t("review.complete.save")}
          </Text>
        </Pressable>
      </View>

      {/* 이탈 확인 — 저장하지 않은 평론을 들고 나가려 할 때만 뜬다 */}
      <ConfirmDialog
        visible={showExitDialog}
        title={t("review.complete.exitConfirmTitle")}
        message={t("review.complete.exitConfirmMessage")}
        actions={[
          { label: t("review.complete.exitConfirmSave"), onPress: handleExitSave, variant: "primary" },
          { label: t("review.complete.exitConfirmDiscard"), onPress: handleExitDiscard, variant: "destructive" },
          { label: t("review.complete.exitConfirmCancel"), onPress: handleExitCancel },
        ]}
        onClose={handleExitCancel}
      />

      {/* 게스트 저장 유도 — "가입 = 저장(계정 기반 기능)"임을 화면 안에서 보여주는 자리 */}
      <GuestSignInDialog
        visible={showGuestSaveDialog}
        title={t("guest.saveTitle")}
        message={t("guest.saveMessage")}
        onClose={() => setShowGuestSaveDialog(false)}
      />
    </SafeAreaView>
  );
}
