// [보류] 이 스펙은 UI 에 연결되기 전에 작성된 것이라 현재 화면 구조·testID 와 맞지 않는다.
// Detox 1단계에서는 smoke.e2e.ts 만 돌린다. 아래 시나리오는 2단계에서 현재 UI 기준으로 다시 쓴다.
// E2E 테스트: 평론 작성 플로우 (핵심 기능)
// 작품 검색 → 인터뷰 5문답 → 평론 생성 → 히스토리 확인
// 실행: npx detox test -c ios.sim.debug e2e/review-flow.e2e.ts
import { device, element, by, expect as detoxExpect, waitFor } from "detox";

describe.skip("평론 작성 플로우", () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      launchArgs: {
        E2E_EMAIL: "e2e_seed@tastic.app",
        E2E_PASSWORD: "Seed1234!",
        E2E_AUTO_LOGIN: "true", // 로그인 화면 스킵
      },
    });
    // 홈(평론 탭)이 로드될 때까지 대기
    await waitFor(element(by.id("review-home-screen"))).toBeVisible().withTimeout(10_000);
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  // ── 시나리오 1: 정상 평론 작성 ───────────────────────────

  describe("정상 평론 작성", () => {
    it("작품 검색 및 선택", async () => {
      await element(by.id("search-content-button")).tap();
      await element(by.id("search-input")).typeText("기생충");

      // 결과가 나올 때까지 대기 (AI 검색이라 시간이 걸릴 수 있음)
      await waitFor(element(by.text("기생충"))).toBeVisible().withTimeout(15_000);
      await element(by.text("기생충")).tap();

      // 작품 확인 화면
      await detoxExpect(element(by.id("content-confirm-screen"))).toBeVisible();
    });

    it("작품 확인 후 인터뷰 시작", async () => {
      await element(by.id("start-interview-button")).tap();
      await detoxExpect(element(by.id("interview-screen"))).toBeVisible();
    });

    it("5개 질문에 답변 후 미리보기 버튼 활성화", async () => {
      // 5번 반복: 질문 로드 확인 → 답변 입력 → 다음 질문
      for (let i = 0; i < 5; i++) {
        await waitFor(element(by.id("question-text"))).toBeVisible().withTimeout(20_000);
        await element(by.id("answer-input")).typeText(`테스트 답변 ${i + 1}`);
        await element(by.id("submit-answer-button")).tap();
      }

      // 5번 답변 후 미리보기 버튼 활성화
      await detoxExpect(element(by.id("preview-button"))).toBeVisible();
      await detoxExpect(element(by.id("preview-button"))).not.toHaveToggleValue(false);
    });

    it("평론 생성 완료 후 ReviewComplete 화면 진입", async () => {
      await element(by.id("finish-interview-button")).tap();

      // 평론 생성에 최대 30초 소요
      await waitFor(element(by.id("review-complete-screen"))).toBeVisible().withTimeout(35_000);

      // 평론 본문이 비어있지 않아야 함
      await detoxExpect(element(by.id("review-body-text"))).toBeVisible();
    });

    it("평론 저장 후 히스토리 탭에서 확인", async () => {
      await element(by.id("save-review-button")).tap();

      // 히스토리 탭으로 이동
      await element(by.id("tab-history")).tap();
      await detoxExpect(element(by.id("history-screen"))).toBeVisible();

      // 방금 저장한 평론이 목록에 있어야 함
      await waitFor(element(by.text("기생충"))).toBeVisible().withTimeout(5_000);
    });
  });

  // ── 시나리오 2: 드래프트 저장 및 복원 ────────────────────

  describe("드래프트 저장 및 복원", () => {
    beforeAll(async () => {
      // 평론 탭으로 이동
      await element(by.id("tab-review")).tap();
      await waitFor(element(by.id("review-home-screen"))).toBeVisible().withTimeout(5_000);
    });

    it("인터뷰 도중 앱을 껐다가 재시작하면 드래프트 복원", async () => {
      // 작품 선택 및 인터뷰 시작
      await element(by.id("search-content-button")).tap();
      await element(by.id("search-input")).typeText("오펜하이머");
      await waitFor(element(by.text("오펜하이머"))).toBeVisible().withTimeout(15_000);
      await element(by.text("오펜하이머")).tap();
      await element(by.id("start-interview-button")).tap();

      // 2개만 답변
      for (let i = 0; i < 2; i++) {
        await waitFor(element(by.id("question-text"))).toBeVisible().withTimeout(20_000);
        await element(by.id("answer-input")).typeText(`중간 답변 ${i + 1}`);
        await element(by.id("submit-answer-button")).tap();
      }

      // 앱 백그라운드 → 재시작
      await device.sendToHome();
      await device.launchApp({ newInstance: false }); // 같은 인스턴스 재시작 (드래프트 유지)

      // 드래프트 복원 배너 또는 이어쓰기 버튼이 보여야 함
      await waitFor(
        element(by.id("resume-draft-button")).or(element(by.text("이어서 작성하기")))
      ).toBeVisible().withTimeout(5_000);
    });

    it("이어쓰기 선택 시 기존 답변 수가 유지됨", async () => {
      await element(by.id("resume-draft-button")).tap();
      await detoxExpect(element(by.id("interview-screen"))).toBeVisible();

      // 이미 2개 답변했으므로 questionCount가 2로 복원되어야 함
      // (미리보기 버튼은 5개 미만이므로 비활성화 상태)
      await detoxExpect(element(by.id("preview-button"))).not.toBeVisible();
    });
  });

  // ── 시나리오 3: 네트워크 단절 처리 ──────────────────────

  describe("네트워크 단절", () => {
    it("오프라인 상태에서 NetworkBanner 표시", async () => {
      // 네트워크 차단
      await device.setURLBlacklist([".*"]);

      // 작품 검색 시도
      await element(by.id("tab-review")).tap();
      await element(by.id("search-content-button")).tap();
      await element(by.id("search-input")).typeText("어떤작품");
      await element(by.id("search-submit-button")).tap();

      // 네트워크 배너가 떠야 함
      await waitFor(element(by.id("network-banner"))).toBeVisible().withTimeout(5_000);

      // 복구
      await device.setURLBlacklist([]);
    });
  });
});
