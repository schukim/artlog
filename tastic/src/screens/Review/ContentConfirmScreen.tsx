import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { ReviewStackParamList } from "../../types/navigation";
import type { ContentCandidate } from "../../types/llm";
import { verifyContent } from "../../services/claude";
import { createContent } from "../../services/content";
import { saveVerifiedWork } from "../../services/work";
import { SkeletonCard } from "../../components/common/SkeletonCard";
import { CATEGORY_ICONS } from "../../components/common/CategoryChip";
import { useAuthStore } from "../../stores/authStore";
import { useGuestStore } from "../../stores/guestStore";
import { guestWorkToLocalWork } from "../../utils/guestWork";
import { resolveLlmLanguage } from "../../utils/llmLanguage";
import type { GuestWork } from "../../utils/guestStorage";

type Nav = NativeStackNavigationProp<ReviewStackParamList, "ContentConfirm">;
type Route = RouteProp<ReviewStackParamList, "ContentConfirm">;

export function ContentConfirmScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const user = useAuthStore((s) => s.user);
  const isGuest = useGuestStore((s) => s.isGuest);
  const setPendingWork = useGuestStore((s) => s.setPendingWork);

  const { title, creator: inputCreator, category, musicType } = route.params;

  const [candidates, setCandidates] = useState<ContentCandidate[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isManualMode, setIsManualMode] = useState(false);
  const [manualCreator, setManualCreator] = useState(inputCreator);
  const [manualYear, setManualYear] = useState("");
  // 결과가 글로벌 캐시에서 왔는지 — true일 때만 '재검색' 버튼 노출
  const [cacheHit, setCacheHit] = useState(false);
  // 캐시 히트가 확정이 아니라 '제안'(제목이 비슷할 뿐)인 경우.
  // 이때는 후보를 미리 선택하지 않고, 맞는지 묻는 문구를 띄운다 — 판단은 사용자가 한다.
  const [isSuggestion, setIsSuggestion] = useState(false);
  // 재검색은 플랜 무관 세션당 최대 3회
  const MAX_RESEARCH = 3;
  const [researchCount, setResearchCount] = useState(0);

  useEffect(() => {
    fetchCandidates();
  }, []);

  // skipCache=true면 캐시를 건너뛰고 웹서치 강제('재검색')
  const fetchCandidates = async (skipCache = false) => {
    if (skipCache) {
      if (researchCount >= MAX_RESEARCH) return;
      setResearchCount((c) => c + 1);
    }
    setIsLoading(true);
    setFetchError(null);
    setSelectedIndex(null);
    try {
      const response = await verifyContent({
        title,
        creator: inputCreator || undefined,
        category,
        // 게스트는 계정(users.language)이 없어 기기 언어를 따른다 — utils/llmLanguage.ts
        language: resolveLlmLanguage(user),
        skipCache,
        // 재검색이면 서버에 별칭(원제) 해석 패스를 강제해 다른 검색어로 다시 훑게 한다.
        // 이게 없으면 같은 질의 → 같은 결과라 버튼이 사실상 무의미하다.
        retry: skipCache,
      });
      setCandidates(response.candidates);
      setCacheHit(response._debug?.cache_hit === true);
      setIsSuggestion(response._debug?.suggested === true);

      // 웹서칭 출처 확인용 — 실제 인용 도메인/URL을 콘솔에 찍는다(개발 전용).
      // 프로덕션에선 로그 노이즈·메타데이터 노출을 피하기 위해 출력하지 않는다.
      if (__DEV__ && response._debug) {
        const d = response._debug;
        console.log(
          `[verify-content] "${title}" — 검색 ${d.search_count}회 / ${d.ms}ms / 출처 도메인:`,
          d.cited_domains
        );
        // Hermes 등 console.table 미지원 런타임에서 크래시하지 않도록 가드
        console.table?.(d.citations);
      }

      // 확신 후보가 하나뿐이면 미리 선택해 둔다(카드 하이라이트 — 화면이 넘어가진 않는다).
      // 제안(제목만 비슷한 캐시 히트)은 제외한다 — 사용자가 제목을 읽고 직접 고르게 한다.
      // state 는 아직 반영 전이라 응답값을 직접 본다.
      if (
        response._debug?.suggested !== true &&
        response.candidates.length === 1 &&
        response.candidates[0].confidence === "high"
      ) {
        setSelectedIndex(0);
      }
    } catch (e) {
      console.error("verifyContent error:", e);
      setFetchError(e instanceof Error ? e.message : t("review.confirm.searchError"));
      setCandidates([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNext = async () => {
    if (!user && !isGuest) return;
    setSaveError(null);
    setIsSaving(true);
    try {
      let contentData;
      const musicMeta = musicType ? { music_type: musicType } : {};

      // 게스트는 서버에 작품을 만들지 않는다 — 메모리 Work 로 인터뷰만 진행하고,
      // 실제 works 행은 로그인 후 이전 시점에 guestMigration 이 만든다.
      if (isGuest) {
        const candidate = !isManualMode && selectedIndex !== null ? candidates[selectedIndex] : null;
        if (!isManualMode && !candidate) return;

        const guestWork: GuestWork = candidate
          ? {
              title: candidate.title,
              originalTitle: candidate.original_title ?? null,
              category,
              creator: candidate.creator ?? null,
              year: candidate.year ?? null,
              genre: candidate.genre ?? null,
              metadata: { ...candidate.metadata, ...musicMeta },
              verified: true,
            }
          : {
              title,
              category,
              creator: manualCreator || null,
              year: manualYear ? parseInt(manualYear, 10) : null,
              metadata: musicMeta,
              verified: false,
            };

        setPendingWork(guestWork);
        navigation.navigate("Interview", { content: guestWorkToLocalWork(guestWork) });
        return;
      }

      if (!user) return;

      if (isManualMode) {
        contentData = await createContent({
          userId: user.id,
          title,
          category,
          creator: manualCreator || undefined,
          year: manualYear ? parseInt(manualYear, 10) : undefined,
          metadata: musicMeta,
        });
      } else if (selectedIndex !== null) {
        const candidate = candidates[selectedIndex];
        // 후보를 확정하면 is_verified=true로 승격해 전역 캐시로 공유 (service-role 엣지 함수)
        contentData = await saveVerifiedWork({
          title: candidate.title,
          originalTitle: candidate.original_title ?? undefined,
          category,
          creator: candidate.creator ?? undefined,
          year: candidate.year ?? undefined,
          genre: candidate.genre ?? undefined,
          metadata: { ...candidate.metadata, ...musicMeta },
        });
      } else {
        return;
      }
      navigation.navigate("Interview", { content: contentData });
    } catch (e) {
      console.error("handleNext error:", e);
      setSaveError(e instanceof Error ? e.message : t("review.confirm.saveError"));
    } finally {
      setIsSaving(false);
    }
  };

  const isValid = isManualMode || selectedIndex !== null;

  const confidenceColor = (conf: string) => {
    if (conf === "high") return "bg-success/20 text-success";
    if (conf === "medium") return "bg-yellow-100 text-yellow-700";
    return "bg-surface-tertiary text-text-secondary";
  };

  return (
    <SafeAreaView testID="content-confirm-screen" className="flex-1 bg-surface">
      <ScrollView className="flex-1 px-6 pt-8" contentContainerClassName="pb-8">
        {/* Header */}
        <Text className="text-text text-2xl font-bold mb-2">{t("review.confirm.title")}</Text>
        <Text className="text-text-secondary text-[15px] mb-6">
          {CATEGORY_ICONS[category]} {title}
        </Text>

        {/* Fetch error */}
        {fetchError && !isLoading && (
          <View className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-3">
            <Text className="text-red-600 text-[15px] mb-2">{fetchError}</Text>
            <Pressable onPress={() => fetchCandidates()}>
              <Text className="text-primary text-[15px] font-medium">{t("common.retry")}</Text>
            </Pressable>
          </View>
        )}

        {/* Loading */}
        {isLoading && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}

        {/* 제안 안내: 제목이 비슷할 뿐 확정이 아니라는 것을 분명히 한다.
            아래 '재검색'으로 웹서치를 강제할 수 있다. */}
        {!isLoading && isSuggestion && candidates.length > 0 && (
          <View className="bg-yellow-50 border border-yellow-200 rounded-2xl px-4 py-3 mb-3">
            <Text className="text-yellow-800 text-[15px]">{t("review.confirm.similarTitle")}</Text>
          </View>
        )}

        {/* Candidate cards */}
        {!isLoading && candidates.map((candidate, index) => (
          <Pressable
            key={index}
            className={`border rounded-2xl p-4 mb-3 ${
              selectedIndex === index && !isManualMode
                ? "border-primary bg-primary/5"
                : "border-surface-tertiary"
            }`}
            onPress={() => { setSelectedIndex(index); setIsManualMode(false); }}
          >
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-text text-base font-semibold flex-1">{candidate.title}</Text>
              <View className={`px-2 py-0.5 rounded-full ${confidenceColor(candidate.confidence)}`}>
                <Text className="text-[13px] font-medium">{candidate.confidence}</Text>
              </View>
            </View>
            {candidate.creator && (
              <Text className="text-text-secondary text-[15px]">{candidate.creator}</Text>
            )}
            <View className="flex-row mt-1">
              {candidate.year && (
                <Text className="text-text-tertiary text-[13px] mr-3">{candidate.year}</Text>
              )}
              {candidate.genre && (
                <Text className="text-text-tertiary text-[13px]">{candidate.genre}</Text>
              )}
            </View>
          </Pressable>
        ))}

        {/* 재검색: 캐시에서 온 결과일 때만 노출. 웹서치 결과에는 표시 안 함. 세션당 최대 3회 */}
        {!isLoading && cacheHit && candidates.length > 0 && researchCount < MAX_RESEARCH && (
          <Pressable
            className="border border-primary/40 rounded-2xl p-4 mb-3 items-center"
            onPress={() => fetchCandidates(true)}
          >
            <Text className="text-primary text-[15px] font-medium">
              🔍 {t("review.confirm.research")}
            </Text>
          </Pressable>
        )}

        {/* No results: 재검색(최대 3회) + manual input */}
        {!isLoading && candidates.length === 0 && (
          <>
            {researchCount < MAX_RESEARCH ? (
              <Pressable
                className="border border-primary/40 rounded-2xl p-4 mb-3 items-center"
                onPress={() => fetchCandidates(true)}
              >
                <Text className="text-primary text-[15px] font-medium">
                  🔍 {t("review.confirm.research")}
                </Text>
              </Pressable>
            ) : (
              <Text className="text-text-tertiary text-[13px] text-center mb-3">
                {t("review.confirm.researchLimit")}
              </Text>
            )}
            <Pressable
              className="border border-dashed border-text-tertiary rounded-2xl p-4 mb-3 items-center"
              onPress={() => setIsManualMode(true)}
            >
              <Text className="text-text-secondary text-[15px]">{t("review.confirm.manualInput")}</Text>
            </Pressable>
          </>
        )}

        {/* Manual input */}
        {!isLoading && candidates.length > 0 && (
          <Pressable
            className={`border border-dashed rounded-2xl p-4 mb-3 items-center ${
              isManualMode ? "border-primary" : "border-text-tertiary"
            }`}
            onPress={() => { setIsManualMode(true); setSelectedIndex(null); }}
          >
            <Text className="text-text-secondary text-[15px]">{t("review.confirm.manualInput")}</Text>
          </Pressable>
        )}

        {/* Manual input fields */}
        {isManualMode && (
          <View className="mt-2 mb-4">
            <TextInput
              className="bg-surface-secondary border border-surface-tertiary rounded-xl px-4 py-3 text-text text-[15px] mb-3"
              placeholder={t("review.confirm.creatorOptional")}
              placeholderTextColor="#94A3B8"
              value={manualCreator}
              onChangeText={setManualCreator}
            />
            <TextInput
              className="bg-surface-secondary border border-surface-tertiary rounded-xl px-4 py-3 text-text text-[15px]"
              placeholder={t("review.confirm.yearOptional")}
              placeholderTextColor="#94A3B8"
              value={manualYear}
              onChangeText={setManualYear}
              keyboardType="number-pad"
            />
          </View>
        )}
      </ScrollView>

      {/* Bottom button */}
      <View className="px-6 pb-6">
        {saveError && (
          <Text className="text-red-500 text-[15px] text-center mb-3">{saveError}</Text>
        )}
        <Pressable
          className={`rounded-xl py-4 items-center ${isValid && !isSaving ? "bg-primary" : "bg-primary/40"}`}
          onPress={handleNext}
          disabled={!isValid || isSaving}
        >
          <Text className="text-white font-semibold text-base">
            {isSaving ? t("common.saving") : t("review.next")}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
