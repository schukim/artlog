// [보류] 이 스펙은 UI 에 연결되기 전에 작성된 것이라 현재 화면 구조·testID 와 맞지 않는다.
// Detox 1단계에서는 smoke.e2e.ts 만 돌린다. 아래 시나리오는 2단계에서 현재 UI 기준으로 다시 쓴다.
// E2E 테스트: 인증 플로우
// 회원가입 → 로그인 → 홈 진입까지 실제 앱 화면을 시뮬레이션합니다.
// 실행: npx detox test -c ios.sim.debug e2e/auth.e2e.ts
import { device, element, by, expect as detoxExpect } from "detox";

const TEST_EMAIL = `test_${Date.now()}@tastic.app`;
const TEST_PASSWORD = "Test1234!";
const TEST_NICKNAME = "테스트유저";

describe.skip("인증 플로우", () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  // ── 회원가입 ─────────────────────────────────────────────

  describe("회원가입", () => {
    it("회원가입 화면으로 이동", async () => {
      await detoxExpect(element(by.text("로그인"))).toBeVisible();
      await element(by.text("회원가입")).tap();
      await detoxExpect(element(by.text("이메일"))).toBeVisible();
    });

    it("이메일/비밀번호/닉네임 입력 후 가입 완료", async () => {
      await element(by.id("signup-email-input")).typeText(TEST_EMAIL);
      await element(by.id("signup-password-input")).typeText(TEST_PASSWORD);
      await element(by.id("signup-nickname-input")).typeText(TEST_NICKNAME);

      // 카테고리 선택 (최소 1개)
      await element(by.id("category-chip-movie")).tap();

      await element(by.id("signup-submit-button")).tap();

      // 가입 후 로그인 화면 또는 홈으로 이동
      await detoxExpect(
        element(by.text("이메일을 확인해주세요")).or(element(by.id("home-screen")))
      ).toBeVisible();
    });
  });

  // ── 로그인 ───────────────────────────────────────────────

  describe("로그인", () => {
    beforeAll(async () => {
      // 테스트 계정으로 앱 재시작 (이메일 인증 우회용 시드 계정 사용)
      await device.launchApp({
        newInstance: true,
        launchArgs: {
          // CI 환경에서 미리 만들어둔 시드 계정
          E2E_EMAIL: "e2e_seed@tastic.app",
          E2E_PASSWORD: "Seed1234!",
        },
      });
    });

    it("이메일/비밀번호 입력 후 홈 진입", async () => {
      await element(by.id("login-email-input")).typeText("e2e_seed@tastic.app");
      await element(by.id("login-password-input")).typeText("Seed1234!");
      await element(by.id("login-submit-button")).tap();

      // 홈(평론 탭)이 보여야 함
      await detoxExpect(element(by.id("review-home-screen"))).toBeVisible();
    });

    it("잘못된 비밀번호 → 에러 메시지 표시", async () => {
      await device.launchApp({ newInstance: true });

      await element(by.id("login-email-input")).typeText("e2e_seed@tastic.app");
      await element(by.id("login-password-input")).typeText("wrongpassword");
      await element(by.id("login-submit-button")).tap();

      await detoxExpect(element(by.text("이메일 또는 비밀번호가 올바르지 않습니다"))).toBeVisible();
    });
  });
});
