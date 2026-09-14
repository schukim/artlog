import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Polyline, Polygon, Path, Line, Rect } from "react-native-svg";
import { useTranslation } from "react-i18next";
import type { MainTabParamList } from "../types/navigation";
import { useTheme } from "../hooks/useTheme";
import { HistoryScreen } from "../screens/History/HistoryScreen";
import { RecommendScreen } from "../screens/Recommend/RecommendScreen";
import { ReviewStack } from "./ReviewStack";
import { AnalysisScreen } from "../screens/Analysis/AnalysisScreen";
import { MyScreen } from "../screens/My/MyScreen";

// ── Enhanced SVG tab icons with theme awareness ─────────────────────────────────
type IconProps = { focused: boolean; isDark: boolean };

function IconHistory({ focused, isDark }: IconProps) {
  const stroke = focused
    ? (isDark ? "#D4CFC8" : "#221F1A")
    : (isDark ? "#7A7268" : "#9C9589");
  const sw = focused ? 2.0 : 1.5;
  return (
    <Svg width={24} height={24} viewBox="0 0 20 20" fill="none">
      <Circle cx="10" cy="10" r="7" stroke={stroke} strokeWidth={sw} />
      <Polyline points="10,6 10,10 13,12" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function IconRecommend({ focused, isDark }: IconProps) {
  const stroke = focused
    ? (isDark ? "#D4CFC8" : "#221F1A")
    : (isDark ? "#7A7268" : "#9C9589");
  const sw = focused ? 2.0 : 1.5;
  return (
    <Svg width={24} height={24} viewBox="0 0 20 20" fill="none">
      <Circle cx="10" cy="10" r="7" stroke={stroke} strokeWidth={sw} />
      <Polygon points="13,7 8,9.5 7,13 12,10.5" fill={stroke} />
    </Svg>
  );
}

function IconReview({ focused, isDark }: IconProps) {
  const stroke = focused
    ? (isDark ? "#D4CFC8" : "#221F1A")
    : (isDark ? "#7A7268" : "#9C9589");
  const sw = focused ? 2.0 : 1.5;
  return (
    <Svg width={24} height={24} viewBox="0 0 20 20" fill="none">
      <Path
        d="M5 15 L5 5 Q5 4 6 4 L14 4 Q15 4 15 5 L15 15 L10 12.5 L5 15Z"
        stroke={stroke}
        strokeWidth={sw}
        strokeLinejoin="round"
        fill={focused ? stroke : "none"}
        fillOpacity={focused ? 0.15 : 0}
      />
      <Line x1="7.5" y1="8" x2="12.5" y2="8" stroke={stroke} strokeWidth="1.3" strokeLinecap="round" />
      <Line x1="7.5" y1="10.5" x2="11" y2="10.5" stroke={stroke} strokeWidth="1.3" strokeLinecap="round" />
    </Svg>
  );
}

function IconAnalysis({ focused, isDark }: IconProps) {
  const fill = focused
    ? (isDark ? "#D4CFC8" : "#221F1A")
    : (isDark ? "#7A7268" : "#9C9589");
  return (
    <Svg width={24} height={24} viewBox="0 0 20 20" fill="none">
      <Rect x="4" y="11" width="3" height="5" rx="1" fill={fill} />
      <Rect x="8.5" y="7" width="3" height="9" rx="1" fill={fill} />
      <Rect x="13" y="4" width="3" height="12" rx="1" fill={fill} />
    </Svg>
  );
}

function IconMy({ focused, isDark }: IconProps) {
  const stroke = focused
    ? (isDark ? "#D4CFC8" : "#221F1A")
    : (isDark ? "#7A7268" : "#9C9589");
  const sw = focused ? 2.0 : 1.5;
  return (
    <Svg width={24} height={24} viewBox="0 0 20 20" fill="none">
      <Circle cx="10" cy="7.5" r="3" stroke={stroke} strokeWidth={sw} />
      <Path d="M4 17 C4 13.5 6.7 11 10 11 C13.3 11 16 13.5 16 17" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
    </Svg>
  );
}

const TAB_ICON_MAP: Record<keyof MainTabParamList, (props: IconProps) => React.ReactElement> = {
  HistoryTab:   (p) => <IconHistory   {...p} />,
  RecommendTab: (p) => <IconRecommend {...p} />,
  ReviewTab:    (p) => <IconReview    {...p} />,
  AnalysisTab:  (p) => <IconAnalysis  {...p} />,
  MyTab:        (p) => <IconMy        {...p} />,
};

// ─────────────────────────────────────────────────────────
const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

  // Dynamic colors based on theme
  const colors = {
    active: isDark ? "#D4CFC8" : "#221F1A",
    inactive: isDark ? "#7A7268" : "#9C9589",
    background: isDark ? "#221F1A" : "#F8F6F1",
    border: isDark ? "#333028" : "#EAE7E0",
  };

  return (
    <View style={{ flex: 1 }}>
    <Tab.Navigator
      initialRouteName="ReviewTab"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused }) => TAB_ICON_MAP[route.name]({ focused, isDark }),
        tabBarActiveTintColor: colors.active,
        tabBarInactiveTintColor: colors.inactive,
        tabBarLabelStyle: {
          fontSize: 12,
          fontFamily: "Pretendard",
          fontWeight: "600",
          marginTop: 4,
          marginBottom: 2,
        },
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          shadowOpacity: 0,
          paddingTop: 8,
          paddingBottom: 12 + insets.bottom,
          height: 65 + insets.bottom,
        },
      })}
    >
      <Tab.Screen
        name="HistoryTab"
        component={HistoryScreen}
        options={{ tabBarLabel: t("tabs.history"), tabBarButtonTestID: "tab-history" }}
      />
      <Tab.Screen
        name="RecommendTab"
        component={RecommendScreen}
        options={{ tabBarLabel: t("tabs.recommend"), tabBarButtonTestID: "tab-recommend" }}
      />
      <Tab.Screen
        name="ReviewTab"
        component={ReviewStack}
        options={{ tabBarLabel: t("tabs.review"), tabBarButtonTestID: "tab-review" }}
      />
      <Tab.Screen
        name="AnalysisTab"
        component={AnalysisScreen}
        options={{ tabBarLabel: t("tabs.analysis"), tabBarButtonTestID: "tab-analysis" }}
      />
      <Tab.Screen
        name="MyTab"
        component={MyScreen}
        options={{ tabBarLabel: t("tabs.my"), tabBarButtonTestID: "tab-my" }}
      />
    </Tab.Navigator>
    </View>
  );
}
