// 하네스 검증 스펙.
// 앱이 뜨고, Detox 가 요소를 찾고, 탭이 실제로 먹히는지까지 본다 —
// 플로우 스펙이 실패했을 때 "앱 문제인지 하네스 문제인지"를 가르는 기준점이다.
import { launchAppFresh, becomesPresent, tapWhenPresent } from "./support";

describe("하네스", () => {
  beforeAll(async () => {
    await launchAppFresh();
  });

  it("앱이 실행되고 첫 화면까지 렌더된다", async () => {
    // 첫 화면은 기기 상태에 따라 셋 중 하나다.
    //   - 인트로 투어: 기기에 처음 설치했을 때 1회 (Detox 는 매번 새로 설치하므로 보통 여기)
    //   - 로그인 화면 / 평론(홈) 탭: 이전 상태가 남아 있을 때
    const intro = await becomesPresent("intro-tour-screen", 90_000);
    const login = intro ? false : await becomesPresent("login-screen", 20_000);
    const home = intro || login ? false : await becomesPresent("review-home-screen", 20_000);

    if (!intro && !login && !home) {
      throw new Error("앱이 인트로·로그인·홈 어느 화면에도 도달하지 못했다 — 번들 로딩 실패로 보인다");
    }
    console.log(`[smoke] 첫 화면: ${intro ? "인트로 투어" : login ? "로그인" : "홈"}`);
  });

  it("탭이 실제로 먹힌다 — 인트로 3장을 넘기면 로그인 화면에 닿는다", async () => {
    if (!(await becomesPresent("intro-tour-screen", 10_000))) {
      console.log("[smoke] 인트로가 아니라 건너뜀");
      return;
    }
    // 인트로는 3장이고 마지막 '다음'에서 투어가 끝난다(건너뛰기 버튼은 의도적으로 없다).
    for (let i = 0; i < 3; i++) {
      await tapWhenPresent("intro-next-button", 15_000);
    }
    // 투어를 마치면 로그인 화면(또는 게스트 선택을 거쳐 홈)으로 나간다.
    const login = await becomesPresent("login-screen", 30_000);
    const home = login ? false : await becomesPresent("review-home-screen", 15_000);
    if (!login && !home) {
      throw new Error("인트로를 넘겼는데 로그인·홈 어느 쪽에도 도달하지 못했다 — 탭이 먹지 않은 것");
    }
    console.log(`[smoke] 탭 동작 확인 — 도착: ${login ? "로그인" : "홈"}`);
  });
});
