import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Platform,
  KeyboardAvoidingView,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from "react-native-reanimated";
import type { ReviewStackParamList } from "../../types/navigation";
import type { ContentCategory } from "../../types/database";
import { CategoryChip, CATEGORY_ICONS } from "../../components/common/CategoryChip";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { useAuthStore } from "../../stores/authStore";
import { useGuestStore } from "../../stores/guestStore";
import { GuestSignInDialog } from "../../components/common/GuestSignInDialog";
import { useTheme } from "../../hooks/useTheme";
import { loadDraft, clearDraft, type StoredDraft } from "../../utils/storage";
import {
  fetchUnfinishedInterviews,
  abandonInterview,
  type UnfinishedInterview,
} from "../../services/review";
import { toISODateString } from "../../utils/formatDate";
import { checkUsageLimit, getRemainingGrace, FREE_GRACE } from "../../services/usage";

type Nav = NativeStackNavigationProp<ReviewStackParamList, "ReviewHome">;

const ALL_CATEGORIES: ContentCategory[] = [
  "movie", "music", "book", "art", "series",
];

export function ReviewHomeScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const user = useAuthStore((s) => s.user);
  const isGuest = useGuestStore((s) => s.isGuest);
  const guestInterviewUsed = useGuestStore((s) => s.interviewUsed);
  const { isDark } = useTheme();
  const { height } = useWindowDimensions();

  const [category, setCategory] = useState<ContentCategory | null>(null);
  const [musicType, setMusicType] = useState<"album" | "song">("album");
  const [title, setTitle] = useState("");
  const [creator, setCreator] = useState("");
  const [experienceDate] = useState(toISODateString(new Date()));
  const [isExpanded, setIsExpanded] = useState(false);
  const [showLimitDialog, setShowLimitDialog] = useState(false);
  // 게스트 체험(1회) 소진 안내 — 로그인으로 유도
  const [showGuestLimitDialog, setShowGuestLimitDialog] = useState(false);
  // 진행 중 인터뷰 드래프트 — 배너로 노출, 새 인터뷰 시작 시 덮어쓰기 경고
  const [draft, setDraft] = useState<StoredDraft | null>(null);
  const [showOverwriteDialog, setShowOverwriteDialog] = useState(false);
  // 온보딩 그레이스(첫 3편 일일 한도 면제) 잔여 편수 — 0이면 배너 미노출
  const [graceLeft, setGraceLeft] = useState(0);
  // 인터뷰는 끝냈는데 평론이 남지 않은 건 — 서버 기준 복구 진입점.
  // 로컬 드래프트 복구는 같은 기기·7일 한정이라, 기기를 바꿨거나 오래된 건은 여기로만 닿는다.
  const [unfinished, setUnfinished] = useState<UnfinishedInterview[]>([]);

  const titleRef = useRef<TextInput>(null);

  // Animate the top padding of the whole content block
  const paddingTop = useSharedValue(height * 0.32);
  const fieldsOpacity = useSharedValue(0);
  const fieldsTranslateY = useSharedValue(16);

  // Entrance animations
  const ENTER = { duration: 420, easing: Easing.out(Easing.cubic) };
  const greetingOpacity = useSharedValue(0);
  const greetingTranslateY = useSharedValue(18);
  const subtitleOpacity = useSharedValue(0);
  const subtitleTranslateY = useSharedValue(18);
  const chip0Opacity = useSharedValue(0);
  const chip0TranslateY = useSharedValue(14);
  const chip1Opacity = useSharedValue(0);
  const chip1TranslateY = useSharedValue(14);
  const chip2Opacity = useSharedValue(0);
  const chip2TranslateY = useSharedValue(14);
  const chip3Opacity = useSharedValue(0);
  const chip3TranslateY = useSharedValue(14);
  const chip4Opacity = useSharedValue(0);
  const chip4TranslateY = useSharedValue(14);

  const greetingStyle = useAnimatedStyle(() => ({
    opacity: greetingOpacity.value,
    transform: [{ translateY: greetingTranslateY.value }],
  }));
  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacity.value,
    transform: [{ translateY: subtitleTranslateY.value }],
  }));
  const chipStyles = [
    useAnimatedStyle(() => ({ opacity: chip0Opacity.value, transform: [{ translateY: chip0TranslateY.value }] })),
    useAnimatedStyle(() => ({ opacity: chip1Opacity.value, transform: [{ translateY: chip1TranslateY.value }] })),
    useAnimatedStyle(() => ({ opacity: chip2Opacity.value, transform: [{ translateY: chip2TranslateY.value }] })),
    useAnimatedStyle(() => ({ opacity: chip3Opacity.value, transform: [{ translateY: chip3TranslateY.value }] })),
    useAnimatedStyle(() => ({ opacity: chip4Opacity.value, transform: [{ translateY: chip4TranslateY.value }] })),
  ];

  useEffect(() => {
    greetingOpacity.value = withDelay(0, withTiming(1, ENTER));
    greetingTranslateY.value = withDelay(0, withTiming(0, ENTER));
    subtitleOpacity.value = withDelay(120, withTiming(1, ENTER));
    subtitleTranslateY.value = withDelay(120, withTiming(0, ENTER));
    const chipOpacities = [chip0Opacity, chip1Opacity, chip2Opacity, chip3Opacity, chip4Opacity];
    const chipTranslates = [chip0TranslateY, chip1TranslateY, chip2TranslateY, chip3TranslateY, chip4TranslateY];
    chipOpacities.forEach((sv, i) => { sv.value = withDelay(260 + i * 90, withTiming(1, ENTER)); });
    chipTranslates.forEach((sv, i) => { sv.value = withDelay(260 + i * 90, withTiming(0, ENTER)); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    paddingTop: paddingTop.value,
  }));

  const fieldsStyle = useAnimatedStyle(() => ({
    opacity: fieldsOpacity.value,
    transform: [{ translateY: fieldsTranslateY.value }],
  }));

  const expandForm = useCallback(() => {
    if (isExpanded) return;
    setIsExpanded(true);
    paddingTop.value = withTiming(64, { duration: 350, easing: Easing.out(Easing.cubic) });
    fieldsOpacity.value = withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) });
    fieldsTranslateY.value = withTiming(0, { duration: 350, easing: Easing.out(Easing.cubic) });
  }, [isExpanded, paddingTop, fieldsOpacity, fieldsTranslateY]);

  const handleSelectCategory = useCallback((cat: ContentCategory) => {
    setCategory(cat);
    setMusicType("album");
    setTitle("");
    setCreator("");
    expandForm();
    setTimeout(() => titleRef.current?.focus(), 400);
  }, [expandForm]);

  // 인터뷰에서 '저장하고 나가기'로 돌아온 경우에도 보이도록 포커스마다 드래프트 확인
  useFocusEffect(
    useCallback(() => {
      if (user) {
        loadDraft(user.id).then(setDraft);
        // 평론 없이 끝난 인터뷰 — 실패해도 홈 화면을 막지 않는다
        fetchUnfinishedInterviews(user.id).then(setUnfinished).catch(() => setUnfinished([]));
        // 온보딩 그레이스 잔여분 — 남아 있을 때만 배너로 노출한다.
        // 분석·추천이 3편에서 열린다는 사실을 첫 화면에서 알리는 것이 목적이라,
        // 소진(0) 이후에는 조용히 사라진다.
        getRemainingGrace(user.id, user.plan, "review").then(setGraceLeft);
      } else {
        setDraft(null);
        setGraceLeft(0);
        setUnfinished([]);
      }
    }, [user])
  );

  const handleDraftContinue = () => {
    if (!draft) return;
    setShowOverwriteDialog(false);
    navigation.navigate("Interview", { content: draft.content });
  };

  const handleDraftDiscard = async () => {
    await clearDraft();
    setDraft(null);
  };

  // 평론 생성 화면으로 곧장 보낸다 — 문답은 이미 다 있으므로 인터뷰를 다시 할 필요가 없다.
  // 재생성 비용은 interview_id 로 중복 차감되지 않는다(서버 consume_usage 의 ref_id).
  const handleUnfinishedContinue = (item: UnfinishedInterview) => {
    navigation.navigate("ReviewComplete", {
      content: item.work,
      conversation: item.conversation,
      interviewId: item.id,
    });
  };

  // 문답 자체는 지우지 않고 노출만 멈춘다(status='abandoned').
  const handleUnfinishedDismiss = async (item: UnfinishedInterview) => {
    setUnfinished((prev) => prev.filter((u) => u.id !== item.id));
    await abandonInterview(item.id).catch(() => {});
  };

  const isValid = title.trim().length > 0 && category !== null;

  const goToConfirm = () => {
    if (!category) return;
    navigation.navigate("ContentConfirm", {
      title: title.trim(),
      creator: creator.trim(),
      category,
      experienceDate,
      musicType: category === "music" ? musicType : undefined,
    });
  };

  const handleNext = async () => {
    if (!isValid || !category) return;

    // 게스트: 체험 1회만 허용. 서버 사용량(usage_logs)은 건드리지 않고 로컬로만 판단한다.
    if (isGuest) {
      if (guestInterviewUsed) {
        setShowGuestLimitDialog(true);
        return;
      }
      goToConfirm();
      return;
    }

    if (!user) return;
    // 무료 플랜 하루 1편 사전 체크 (최종 검증은 서버사이드)
    const allowed = await checkUsageLimit(user.id, user.plan, "review");
    if (!allowed) {
      setShowLimitDialog(true);
      return;
    }
    // 진행 중 인터뷰가 있으면 첫 답변 제출 시 조용히 덮어써지므로 먼저 확인받는다
    if (draft) {
      setShowOverwriteDialog(true);
      return;
    }
    goToConfirm();
  };

  const handleOverwriteStartNew = async () => {
    await clearDraft();
    setDraft(null);
    setShowOverwriteDialog(false);
    goToConfirm();
  };

  return (
    <SafeAreaView
      className={`flex-1 ${isDark ? 'dark' : ''}`}
      style={{ backgroundColor: isDark ? '#1A1814' : '#F8F6F1' }}
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Animated.ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
          style={containerStyle}
        >
          {/* 온보딩 그레이스 배너 — 첫 3편은 하루 제한 없이 쓸 수 있음을 알린다 */}
          {graceLeft > 0 && (
            <View className="bg-primary/10 dark:bg-primary-dm/15 border border-primary/25 dark:border-primary-dm/30 rounded-2xl px-4 py-3 mb-6">
              <Text className="text-text dark:text-text-dark text-[14px] font-semibold mb-0.5">
                {t("review.grace.bannerTitle", { total: FREE_GRACE.review })}
              </Text>
              <Text className="text-text-secondary dark:text-text-dark-secondary text-[13px] leading-5">
                {graceLeft === 1
                  ? t("review.grace.bannerBodyLast")
                  : t("review.grace.bannerBody", { remaining: graceLeft })}
              </Text>
            </View>
          )}

          {/* 마무리하지 못한 평론 — 인터뷰는 끝났는데 평론이 저장되지 않은 건 */}
          {unfinished.map((item) => (
            <View
              key={item.id}
              className="bg-surface-secondary dark:bg-surface-dark-secondary border border-primary/30 rounded-2xl p-4 mb-6"
            >
              <Text className="text-text-tertiary dark:text-text-dark-tertiary text-[13px] mb-1">
                {t("review.unfinished.bannerTitle")}
              </Text>
              <Text
                className="text-text dark:text-text-dark text-base font-semibold mb-1"
                numberOfLines={1}
              >
                {CATEGORY_ICONS[item.work.category]} {item.work.title}
              </Text>
              <Text className="text-text-secondary dark:text-text-dark-secondary text-[13px] mb-3">
                {t("review.unfinished.description")}
              </Text>
              <View className="flex-row items-center gap-2">
                <Pressable
                  className="flex-1 bg-primary dark:bg-primary-dm rounded-xl py-2.5 items-center"
                  onPress={() => handleUnfinishedContinue(item)}
                >
                  <Text className="text-white font-medium text-[15px]">
                    {t("review.unfinished.continue")}
                  </Text>
                </Pressable>
                <Pressable
                  className="px-4 py-2.5"
                  onPress={() => handleUnfinishedDismiss(item)}
                  hitSlop={4}
                >
                  <Text className="text-text-secondary dark:text-text-dark-secondary text-[15px]">
                    {t("common.delete")}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}

          {/* 진행 중 인터뷰 배너 */}
          {draft && (
            <View className="bg-surface-secondary dark:bg-surface-dark-secondary border border-surface-tertiary dark:border-surface-dark-border rounded-2xl p-4 mb-6">
              <Text className="text-text-tertiary dark:text-text-dark-tertiary text-[13px] mb-1">
                {t("review.draft.bannerTitle")}
              </Text>
              <Text
                className="text-text dark:text-text-dark text-base font-semibold mb-3"
                numberOfLines={1}
              >
                {CATEGORY_ICONS[draft.content.category]} {draft.content.title}
              </Text>
              <View className="flex-row items-center gap-2">
                <Pressable
                  className="flex-1 bg-primary dark:bg-primary-dm rounded-xl py-2.5 items-center"
                  onPress={handleDraftContinue}
                >
                  <Text className="text-white font-medium text-[15px]">
                    {t("review.draft.continue")}
                  </Text>
                </Pressable>
                <Pressable className="px-4 py-2.5" onPress={handleDraftDiscard} hitSlop={4}>
                  <Text className="text-text-secondary dark:text-text-dark-secondary text-[15px]">
                    {t("common.delete")}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Greeting */}
          <Animated.View style={greetingStyle}>
            <Text className="text-text dark:text-text-dark text-2xl font-bold leading-9 mb-6">
              {/* 게스트는 닉네임이 없어 "{{name}}님," 자리가 비어버린다 — 전용 문구 사용 */}
              {isGuest ? t("guest.greeting") : t("review.greeting", { name: user?.nickname ?? "" })}
            </Text>
          </Animated.View>

          {/* Category chips */}
          {!isExpanded && (
            <Animated.View style={subtitleStyle}>
              <Text className="text-text-secondary dark:text-text-dark-secondary text-[15px] mb-3">
                {t("review.selectCategory")}
              </Text>
            </Animated.View>
          )}
          <View className="flex-row mb-4 gap-1.5">
            {ALL_CATEGORIES.map((cat, i) => (
              <Animated.View key={cat} style={[chipStyles[i], { flex: 1 }]}>
                <CategoryChip
                  category={cat}
                  selected={category === cat}
                  fluid
                  onPress={() => {
                    if (isExpanded) {
                      setCategory(cat);
                      setMusicType("album");
                      setTitle("");
                      setCreator("");
                      setTimeout(() => titleRef.current?.focus(), 100);
                    } else {
                      handleSelectCategory(cat);
                    }
                  }}
                />
              </Animated.View>
            ))}
          </View>

          {/* Form fields */}
          <Animated.View style={fieldsStyle}>
            <TextInput
              ref={titleRef}
              className="bg-surface-secondary dark:bg-surface-dark-secondary border border-surface-tertiary dark:border-surface-dark-border rounded-xl px-4 py-3.5 text-text dark:text-text-dark text-base mb-3"
              placeholder={t("review.titlePlaceholder")}
              placeholderTextColor={isDark ? '#7A7268' : '#9C9589'}
              value={title}
              onChangeText={setTitle}
              maxLength={200}
            />

            {category === "music" && (
              <View className="flex-row mb-3 rounded-xl overflow-hidden border border-surface-tertiary dark:border-surface-dark-border">
                <Pressable
                  className={`flex-1 py-3 items-center ${musicType === "album" ? "bg-primary dark:bg-primary-dm" : "bg-surface-secondary dark:bg-surface-dark-secondary"}`}
                  onPress={() => setMusicType("album")}
                >
                  <Text className={`text-[15px] font-medium ${musicType === "album" ? "text-white" : "text-text-secondary dark:text-text-dark-secondary"}`}>
                    {t("review.musicAlbum")}
                  </Text>
                </Pressable>
                <Pressable
                  className={`flex-1 py-3 items-center ${musicType === "song" ? "bg-primary dark:bg-primary-dm" : "bg-surface-secondary dark:bg-surface-dark-secondary"}`}
                  onPress={() => setMusicType("song")}
                >
                  <Text className={`text-[15px] font-medium ${musicType === "song" ? "text-white" : "text-text-secondary dark:text-text-dark-secondary"}`}>
                    {t("review.musicSong")}
                  </Text>
                </Pressable>
              </View>
            )}

            {category && (
              <TextInput
                className="bg-surface-secondary dark:bg-surface-dark-secondary border border-surface-tertiary dark:border-surface-dark-border rounded-xl px-4 py-3.5 text-text dark:text-text-dark text-base mb-6"
                placeholder={t(`review.creatorLabel.${category}`)}
                placeholderTextColor={isDark ? '#7A7268' : '#9C9589'}
                value={creator}
                onChangeText={setCreator}
                maxLength={100}
              />
            )}

            <Pressable
              className={`rounded-xl py-4 items-center ${isValid ? "bg-primary dark:bg-primary-dm" : "bg-primary/40 dark:bg-primary-dm/40"}`}
              onPress={handleNext}
              disabled={!isValid}
            >
              <Text className="text-white font-semibold text-base">{t("review.next")}</Text>
            </Pressable>
          </Animated.View>
        </Animated.ScrollView>
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={showLimitDialog}
        title={t("membership.limitTitle")}
        message={t("membership.limitReview")}
        actions={[
          { label: t("common.confirm"), onPress: () => setShowLimitDialog(false), variant: "primary" },
        ]}
        onClose={() => setShowLimitDialog(false)}
      />

      {/* 게스트 체험 1회 소진 — 계속하려면 로그인 */}
      <GuestSignInDialog
        visible={showGuestLimitDialog}
        title={t("guest.trialUsedTitle")}
        message={t("guest.trialUsedMessage")}
        onClose={() => setShowGuestLimitDialog(false)}
      />

      {/* 새 인터뷰 시작 시 기존 드래프트 덮어쓰기 확인 */}
      <ConfirmDialog
        visible={showOverwriteDialog}
        title={t("review.draft.overwriteTitle")}
        message={t("review.draft.overwriteMessage", { title: draft?.content.title ?? "" })}
        actions={[
          { label: t("review.draft.continue"), onPress: handleDraftContinue, variant: "primary" },
          { label: t("review.draft.startNew"), onPress: handleOverwriteStartNew, variant: "destructive" },
          { label: t("common.cancel"), onPress: () => setShowOverwriteDialog(false) },
        ]}
        onClose={() => setShowOverwriteDialog(false)}
      />
    </SafeAreaView>
  );
}
