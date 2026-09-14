// 스펙 공통 헬퍼.
//
// 이 앱의 디버그 빌드는 expo-dev-client 가 들어 있어서, 그냥 실행하면 앱이 아니라
// "개발 서버 고르기" 런처 화면에서 멈춘다. Detox 는 그 화면을 앱으로 착각해 대기하다
// 타임아웃난다. 그래서 실행 시 dev-client 딥링크로 Metro 주소를 바로 물려준다.
//
// (CI 로 옮길 때는 Release 시뮬레이터 빌드를 쓰는 편이 낫다 — 번들이 앱에 박혀 있어
//  Metro 도, 이 딥링크도 필요 없다.)
// Release 빌드(기본 구성)는 번들이 앱에 들어 있어 아무것도 물려줄 필요가 없다.
// 디버그 빌드로 돌릴 때만 DETOX_METRO_URL 을 주면 dev-client 런처를 딥링크로 건너뛴다.
const METRO_URL = process.env.DETOX_METRO_URL;
const DEV_CLIENT_URL = METRO_URL
  ? `tastic://expo-development-client/?url=${encodeURIComponent(METRO_URL)}`
  : undefined;

export async function launchAppFresh(
  params: Partial<Detox.DeviceLaunchAppConfig> = {},
): Promise<void> {
  await device.launchApp({
    newInstance: true,
    ...(DEV_CLIENT_URL ? { url: DEV_CLIENT_URL } : {}),
    ...params,
  });

  // 동기화를 끈다.
  //
  // Detox 는 기본적으로 "앱이 한가해질 때까지" 기다렸다가 매처를 실행하는데, 이 앱은
  // 메인 런루프가 영원히 busy 다(trace 로그: dispatch_queue works_count 가 계속 2).
  // 상시 도는 애니메이션 때문으로 보이며, 그 상태에선 어떤 요소도 조회되지 않고
  // 전부 타임아웃난다 — 앱은 멀쩡히 떠 있는데 테스트만 실패한다.
  //
  // 대신 waitFor(...).withTimeout() 폴링으로 기다린다. 자동 동기화를 잃는 대가로
  // 각 대기를 스펙에 명시해야 하지만, 그게 유일하게 동작하는 구성이다.
  await device.disableSynchronization();
}

// ── toBeVisible 대신 toExist 를 쓰는 이유 ──
// 이 앱은 New Architecture(Fabric)로 돈다(뷰 클래스가 RCTViewComponentView).
// 그 환경에서 Detox 의 가시성 판정이 동작하지 않는다 — 화면 전체를 덮는 루트 뷰조차
// getAttributes() 가 visible:false / hittable:false 로 돌려준다(스크린샷에는 멀쩡히 보인다).
// 반면 요소 조회 자체는 정상이라(identifier·frame 모두 정확) toExist 로 판정한다.

/** 해당 testID 가 제한 시간 안에 나타나면 true. 예외는 false 로 흡수한다. */
export async function becomesPresent(testID: string, timeoutMs: number): Promise<boolean> {
  try {
    await waitFor(element(by.id(testID))).toExist().withTimeout(timeoutMs);
    return true;
  } catch {
    return false;
  }
}

/** 나타날 때까지 기다린다. 못 찾으면 그대로 실패시킨다. */
export async function waitPresent(testID: string, timeoutMs = 30_000): Promise<void> {
  await waitFor(element(by.id(testID))).toExist().withTimeout(timeoutMs);
}

/** 나타날 때까지 기다린 뒤 탭한다. */
export async function tapWhenPresent(testID: string, timeoutMs = 30_000): Promise<void> {
  await waitPresent(testID, timeoutMs);
  await element(by.id(testID)).tap();
}
