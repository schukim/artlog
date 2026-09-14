import React, { useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  Image,
  Pressable,
  ScrollView,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type ImageSourcePropType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useIntroStore } from "../../stores/introStore";
import { useGuestStore } from "../../stores/guestStore";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { markIntroSeen } from "../../utils/storage";
import { markGuestSessionStarted } from "../../utils/guestStorage";

// 앱 첫 실행 기능 가이드 — 마케팅 스크린샷(헤드라인·목업 내장)을 슬라이드로 재활용한다.
// 이미지는 ko/en 두 벌이 있어 사용자 언어에 맞는 세트를 보여준다.
// (require 는 정적 리터럴이어야 하므로 언어별 배열을 미리 정의)
const SLIDES: Record<"ko" | "en", ImageSourcePropType[]> = {
  ko: [
    require("../../../assets/intro/intro-1-ko.png"),
    require("../../../assets/intro/intro-2-ko.png"),
    require("../../../assets/intro/intro-3-ko.png"),
  ],
  en: [
    require("../../../assets/intro/intro-1-en.png"),
    require("../../../assets/intro/intro-2-en.png"),
    require("../../../assets/intro/intro-3-en.png"),
  ],
};

// 온보딩 배경은 이미지(밝은 warm 톤)에 맞춰 항상 라이트로 고정한다.
const BG = "#F8F6F1"; // surface.DEFAULT
const INK = "#221F1A"; // primary.DEFAULT
const INK_TEXT = "#FDFCF9"; // surface.secondary — 버튼 위 텍스트
const DOT = "#D8D3CB"; // 비활성 도트

export function IntroTourScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const setSeen = useIntroStore((s) => s.setSeen);
  const enterGuest = useGuestStore((s) => s.enterGuest);
  const [showBrowseConfirm, setShowBrowseConfirm] = useState(false);
  // 로그인 전 화면이라 계정 언어가 없다 — 현재 i18n 언어(기기 로케일 기반)를 따른다.
  const lang: "ko" | "en" = i18n.language?.startsWith("en") ? "en" : "ko";
  const slides = SLIDES[lang];

  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const isLast = index === slides.length - 1;

  const finish = useCallback(() => {
    // introStore 를 즉시 true 로 바꿔 RootNavigator 가 로그인(Auth)으로 전환하고,
    // 기기 로컬에도 기록한다. 스토리지 기록 실패는 UX 를 막지 않는다(다음 실행에 재노출).
    setSeen(true);
    markIntroSeen().catch(() => {});
  }, [setSeen]);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      if (next !== index) setIndex(next);
    },
    [index, width],
  );

  const handleNext = useCallback(() => {
    if (isLast) {
      finish();
      return;
    }
    const next = index + 1;
    scrollRef.current?.scrollTo({ x: next * width, animated: true });
    setIndex(next);
  }, [isLast, index, width, finish]);

  // '먼저 둘러보기' — 가입 없이 Main 으로 진입한다(App Store 5.1.1(v) 대응).
  // 회원가입은 이후 '저장' 시점에만 요구된다.
  //
  // 다만 바로 들여보내지 않고 계정 보유 여부를 먼저 확인한다. 체험은 계정이 없는 사람을
  // 위한 회원가입 퍼널이고, 체험 평론은 새로 만든 계정에만 이전되므로
  // (utils/guestClaim.ts) 계정 보유자가 들어오면 쓴 평론을 잃을 뿐이다.
  // 로그인 전에는 서버에 계정 존재를 물어볼 수 없어 본인 확인에 의존한다.
  const handleBrowsePress = useCallback(() => setShowBrowseConfirm(true), []);

  const startGuest = useCallback(() => {
    setShowBrowseConfirm(false);
    enterGuest();
    // 체험 시작을 기기에 남긴다 — 평론을 만들기 전에 앱을 껐다 켜도 게스트로 되돌아온다
    // (utils/guestRestore.ts). 인트로는 기기당 1회라 이 기록이 없으면 다시 들어올 길이 없다.
    markGuestSessionStarted().catch(() => {});
    finish();
  }, [enterGuest, finish]);

  const goSignIn = useCallback(() => {
    setShowBrowseConfirm(false);
    finish();
  }, [finish]);

  return (
    <View testID="intro-tour-screen" style={{ flex: 1, backgroundColor: BG, paddingTop: insets.top }}>
      {/* 슬라이드 영역 — flex:1 로 하단 컨트롤 바 위 공간만 차지한다.
          컨트롤 바가 이미지를 덮지 않으므로 이미지 아랫부분이 잘리지 않는다. */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        style={{ flex: 1 }}
      >
        {slides.map((src, i) => (
          <View key={i} style={{ width, height: "100%" }}>
            <Image
              source={src}
              style={{ width, flex: 1 }}
              resizeMode="contain"
            />
          </View>
        ))}
      </ScrollView>

      {/* 건너뛰기 버튼은 두지 않는다.
          건너뛰면 곧장 로그인 화면으로 나가는데, 게스트 진입로는 이 투어의 마지막 장에만
          있다(로그인 화면은 계정 보유자용). 즉 건너뛴 사용자는 무가입 체험 경로를 영영
          만나지 못하고, 그건 5.1.1(v) 리젝 사유를 그대로 재현하는 것이다.
          세 장을 끝까지 보게 해서 '둘러보기 / 로그인' 선택을 반드시 거치게 한다. */}

      {/* 하단 컨트롤 바 — 일반 흐름에 배치해 이미지와 겹치지 않게 한다 */}
      <View
        style={{
          paddingBottom: insets.bottom + 20,
          paddingTop: 20,
          paddingHorizontal: 28,
          backgroundColor: BG,
        }}
      >
        {/* 페이지 도트 */}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "center",
            marginBottom: 24,
          }}
        >
          {slides.map((_, i) => (
            <View
              key={i}
              style={{
                width: i === index ? 22 : 7,
                height: 7,
                borderRadius: 4,
                marginHorizontal: 3,
                backgroundColor: i === index ? INK : DOT,
              }}
            />
          ))}
        </View>

        {/* 마지막 장에서만 '먼저 둘러보기'(게스트) 를 함께 노출한다.
            가입은 선택 사항이고, 콘텐츠 체험의 전제조건이 아님을 화면에서 보여주는 자리다.
            계정 보유자를 걸러내는 안내는 이 버튼을 누른 직후 확인 모달이 전담한다 —
            버튼 사이에 같은 내용을 미리 깔면 중복이고 두 버튼의 균형만 깨진다. */}
        {isLast && (
          <Pressable
            onPress={handleBrowsePress}
            android_ripple={{ color: "rgba(0,0,0,0.06)" }}
            style={{
              backgroundColor: "transparent",
              borderWidth: 1.5,
              borderColor: INK,
              borderRadius: 18,
              paddingVertical: 17,
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              marginBottom: 12,
            }}
          >
            <Text style={{ color: INK, fontSize: 16, fontWeight: "700" }}>
              {t("intro.browseFirst")}
            </Text>
          </Pressable>
        )}

        <Pressable
          testID="intro-next-button"
          onPress={handleNext}
          android_ripple={{ color: "rgba(255,255,255,0.15)" }}
          style={{
            backgroundColor: INK,
            borderRadius: 18,
            paddingVertical: 17,
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
          }}
        >
          <Text style={{ color: INK_TEXT, fontSize: 16, fontWeight: "700" }}>
            {isLast ? t("intro.signIn") : t("intro.next")}
          </Text>
        </Pressable>
      </View>

      {/* 체험 진입 전 계정 보유 확인 — 계정이 있는 사람을 로그인으로 되돌린다.
          '계정 없음'을 고르면 가입 없이 그대로 체험이 시작된다(등록은 여전히 선택 사항). */}
      <ConfirmDialog
        visible={showBrowseConfirm}
        title={t("guest.confirmTitle")}
        message={t("guest.confirmMessage")}
        actions={[
          { label: t("guest.confirmHasAccount"), onPress: goSignIn, variant: "primary" },
          { label: t("guest.confirmNoAccount"), onPress: startGuest },
        ]}
        onClose={() => setShowBrowseConfirm(false)}
      />
    </View>
  );
}
