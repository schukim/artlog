// 속편/시즌 판별 — 캐시가 1편과 속편을 같은 작품으로 붙이는 것을 막는 축.
// 배경: trigram 유사도로는 못 가른다. 실측 '악마는 프라다를 입는다' ↔ '…2' = 0.87 로
// 캐시 확정선(0.85)보다 높다. 그래서 번호를 별도 축으로 비교한다.
import { describe, it, expect } from "vitest";

import { seriesKey, sameSeriesEntry } from "../../../supabase/functions/_shared/seriesKey";

describe("seriesKey", () => {
  it("표지가 없는 제목은 빈 문자열", () => {
    expect(seriesKey("악마는 프라다를 입는다")).toBe("");
    expect(seriesKey("Feels So Good")).toBe("");
    expect(seriesKey("기생충")).toBe("");
    expect(seriesKey("")).toBe("");
    expect(seriesKey(null)).toBe("");
  });

  it("끝에 붙은 숫자를 표지로 뽑는다", () => {
    expect(seriesKey("악마는 프라다를 입는다 2")).toBe("n2");
    expect(seriesKey("피의 게임 3")).toBe("n3");
    expect(seriesKey("쿵푸팬더4")).toBe("n4"); // 띄어쓰기 없이 붙은 경우
  });

  it("시즌·부·권 표기를 뽑는다", () => {
    expect(seriesKey("성난 사람들 시즌2")).toBe("s2");
    expect(seriesKey("슬기로운 의사생활 시즌 2")).toBe("s2");
    expect(seriesKey("Stranger Things Season 4")).toBe("s4");
    expect(seriesKey("나의 해방일지 3부")).toBe("s3");
  });

  it("구두점이 섞여도 같은 표지로 본다", () => {
    expect(seriesKey("아바타: 물의 길 2")).toBe("n2");
    expect(seriesKey("Toy Story  3 ")).toBe("n3");
  });

  it("제목 자체가 숫자면 표지가 아니다", () => {
    expect(seriesKey("1987")).toBe("");
  });

  it("제목에 포함된 연도는 표지로 본다 — 1편과 다른 작품이 맞다", () => {
    expect(seriesKey("Blade Runner 2049")).toBe("n2049");
    expect(seriesKey("Blade Runner")).toBe("");
  });
});

describe("sameSeriesEntry", () => {
  it("1편과 속편을 다른 작품으로 가른다", () => {
    expect(sameSeriesEntry("악마는 프라다를 입는다 3", "악마는 프라다를 입는다")).toBe(false);
    expect(sameSeriesEntry("피의 게임 3", "피의 게임")).toBe(false);
    expect(sameSeriesEntry("피의 게임", "피의 게임 3")).toBe(false);
  });

  it("속편끼리 번호가 같으면 같은 작품", () => {
    expect(sameSeriesEntry("악마는 프라다를 입는다 2", "악마는 프라다를 입는다 2")).toBe(true);
  });

  it("오타는 막지 않는다 — 이게 캐시가 잡아야 할 케이스", () => {
    expect(sameSeriesEntry("Feel so good", "Feels So Good")).toBe(true);
  });

  it("원제 쪽 표기로도 맞춰본다", () => {
    expect(sameSeriesEntry("아바타 2", "아바타: 물의 길", "Avatar: The Way of Water 2")).toBe(true);
  });
});
