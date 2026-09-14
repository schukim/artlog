import React from "react";
import { Pressable, Text } from "react-native";
import { useTranslation } from "react-i18next";
import type { ContentCategory } from "../../types/database";

const CATEGORY_ICONS: Record<ContentCategory, string> = {
  movie: "\uD83C\uDFAC",
  music: "\uD83C\uDFB5",
  book: "\uD83D\uDCDA",
  art: "\uD83C\uDFA8",
  series: "\uD83D\uDCFA",
};

interface CategoryChipProps {
  category: ContentCategory;
  selected: boolean;
  onPress: (category: ContentCategory) => void;
  fluid?: boolean;
}

export function CategoryChip({ category, selected, onPress, fluid }: CategoryChipProps) {
  const { t } = useTranslation();

  return (
    <Pressable
      testID={`category-chip-${category}`}
      className={`flex-row items-center justify-center py-2 rounded-full ${
        fluid ? "px-2 w-full" : "px-4 mr-2 mb-2"
      } ${selected ? "bg-primary dark:bg-primary-dm" : "bg-surface-tertiary dark:bg-surface-dark-secondary"}`}
      onPress={() => onPress(category)}
    >
      <Text className="mr-1 text-[15px]">{CATEGORY_ICONS[category]}</Text>
      <Text className={`text-[13px] font-medium ${selected ? "text-white" : "text-text dark:text-text-dark"}`}>
        {t(`category.${category}`)}
      </Text>
    </Pressable>
  );
}

export { CATEGORY_ICONS };
