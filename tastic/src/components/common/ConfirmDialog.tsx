import React from "react";
import { Modal, View, Text, Pressable, ScrollView, ActivityIndicator, Dimensions } from "react-native";
import { useTranslation } from "react-i18next";

const SCREEN_HEIGHT = Dimensions.get("window").height;

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  loading?: boolean;
  // testID: E2E 에서 다이얼로그 버튼을 지목하기 위한 선택 값. 문구가 바뀌어도 셀렉터가 깨지지 않는다.
  actions: {
    label: string;
    onPress: () => void;
    variant?: "primary" | "destructive" | "default";
    testID?: string;
  }[];
  onClose: () => void;
}

export function ConfirmDialog({ visible, title, message, loading, actions, onClose }: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        {/* Backdrop — 다이얼로그와 분리된 별도 레이어 */}
        <Pressable
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)" }}
          onPress={onClose}
        />
        {/* Dialog — backdrop Pressable 안에 중첩되지 않음 */}
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 24 }}>
          <View
            className="bg-surface w-full rounded-2xl p-6"
            style={{ maxHeight: SCREEN_HEIGHT * 0.8 }}
          >
            <Text className="text-text text-lg font-bold mb-4">{title}</Text>
            {loading ? (
              <View className="items-center py-8 mb-4">
                <ActivityIndicator size="large" color="#6366F1" />
                <Text className="text-text-secondary text-[15px] mt-3">{t("common.generating")}</Text>
              </View>
            ) : (
              <ScrollView
                style={{ maxHeight: SCREEN_HEIGHT * 0.45 }}
                showsVerticalScrollIndicator={true}
                className="mb-6"
              >
                <Text className="text-text-secondary text-base leading-6">{message}</Text>
              </ScrollView>
            )}
            <View className="gap-3">
              {actions.map((action) => {
                const bgClass =
                  action.variant === "primary"
                    ? "bg-primary"
                    : action.variant === "destructive"
                    ? "bg-error"
                    : "bg-surface-tertiary";
                const textClass =
                  action.variant === "primary" || action.variant === "destructive"
                    ? "text-white"
                    : "text-text";
                return (
                  <Pressable
                    key={action.label}
                    testID={action.testID}
                    className={`${bgClass} py-3 rounded-xl items-center`}
                    onPress={action.onPress}
                  >
                    <Text className={`${textClass} font-semibold text-base`}>{action.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
