import React, { useRef, useState } from "react";
import { View, Text, Pressable, TextInput } from "react-native";
import { useTranslation } from "react-i18next";
import type { ReviewFeedbackRating, ReviewFeedbackReason } from "../../types/database";
import { submitReviewFeedback } from "../../services/reviewFeedback";

const REASONS: { value: ReviewFeedbackReason; key: string }[] = [
  { value: "not_mine", key: "reasonNotMine" },
  { value: "questions", key: "reasonQuestions" },
  { value: "facts", key: "reasonFacts" },
  { value: "tone", key: "reasonTone" },
  { value: "thin", key: "reasonThin" },
  { value: "other", key: "reasonOther" },
];

type Stage = "ask" | "reason" | "thanks";

interface ReviewFeedbackWidgetProps {
  reviewId: string;
  userId: string;
  // 사용자가 위젯과 처음 상호작용한 순간을 부모에 알린다 — 화면 자동 이탈 타이머를
  // 취소시켜, 피드백을 남기는 도중에 밀려나지 않게 하기 위함.
  onInteract?: () => void;
}

export function ReviewFeedbackWidget({ reviewId, userId, onInteract }: ReviewFeedbackWidgetProps) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>("ask");
  const [reason, setReason] = useState<ReviewFeedbackReason | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const interactedRef = useRef(false);

  const markInteracted = () => {
    if (interactedRef.current) return;
    interactedRef.current = true;
    onInteract?.();
  };

  const submit = async (rating: ReviewFeedbackRating, r?: ReviewFeedbackReason | null, c?: string) => {
    setSubmitting(true);
    try {
      await submitReviewFeedback({ reviewId, userId, rating, reason: r ?? null, comment: c ?? null });
      setStage("thanks");
    } catch (e) {
      // 실패해도 사용자를 막지 않는다 — 조용히 두고 다시 시도할 수 있게 둔다.
      console.error("ReviewFeedbackWidget submit failed:", e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUp = () => {
    markInteracted();
    void submit("up");
  };

  const handleDown = () => {
    markInteracted();
    setStage("reason");
  };

  const handleSend = () => {
    void submit("down", reason, comment);
  };

  const handleEdit = () => {
    setReason(null);
    setComment("");
    setStage("ask");
  };

  if (stage === "thanks") {
    return (
      <View className="mt-6 flex-row items-center">
        <Text className="text-text-secondary dark:text-text-dark-secondary text-[15px]">
          {t("review.feedback.thanks")}
        </Text>
        <Pressable testID="feedback-edit-link" onPress={handleEdit} className="ml-3">
          <Text className="text-text-tertiary text-[13px] underline">{t("review.feedback.editLink")}</Text>
        </Pressable>
      </View>
    );
  }

  if (stage === "reason") {
    return (
      <View className="mt-6">
        <Text className="text-text dark:text-text-dark text-[15px] font-medium mb-3">
          {t("review.feedback.reasonPrompt")}
        </Text>
        <View className="flex-row flex-wrap">
          {REASONS.map(({ value, key }) => {
            const selected = reason === value;
            return (
              <Pressable
                key={value}
                testID={`feedback-reason-${value}`}
                className={`py-2 px-4 mr-2 mb-2 rounded-full ${
                  selected ? "bg-primary dark:bg-primary-dm" : "bg-surface-tertiary dark:bg-surface-dark-secondary"
                }`}
                onPress={() => setReason(selected ? null : value)}
              >
                <Text
                  className={`text-[13px] font-medium ${
                    selected ? "text-white" : "text-text dark:text-text-dark"
                  }`}
                >
                  {t(`review.feedback.${key}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          testID="feedback-comment-input"
          className="bg-surface-tertiary dark:bg-surface-dark-secondary rounded-xl px-4 py-3 text-text dark:text-text-dark text-[14px] mt-1"
          value={comment}
          onChangeText={setComment}
          placeholder={t("review.feedback.commentPlaceholder")}
          placeholderTextColor="#94A3B8"
          multiline
          maxLength={500}
          style={{ minHeight: 64, textAlignVertical: "top" }}
        />
        <Pressable
          testID="feedback-submit-button"
          className="bg-primary rounded-xl py-3 items-center mt-3 self-start px-6"
          onPress={handleSend}
          disabled={submitting}
        >
          <Text className="text-white font-semibold text-[14px]">{t("review.feedback.submit")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="mt-6 flex-row items-center">
      <Text className="text-text dark:text-text-dark text-[15px] font-medium flex-1">
        {t("review.feedback.prompt")}
      </Text>
      <Pressable testID="feedback-up-button" className="px-3 py-2" onPress={handleUp} disabled={submitting}>
        <Text className="text-2xl">👍</Text>
      </Pressable>
      <Pressable testID="feedback-down-button" className="px-3 py-2" onPress={handleDown} disabled={submitting}>
        <Text className="text-2xl">👎</Text>
      </Pressable>
    </View>
  );
}
