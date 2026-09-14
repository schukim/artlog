/** @type {Detox.DetoxConfig} */
// Detox E2E 설정 — 1단계는 iOS 시뮬레이터만.
//
// Android 를 뺀 이유: Android 는 Detox 테스트 러너를 네이티브에 심어야 하고
// (@config-plugins/detox), 그 플러그인이 아직 Expo 53 까지만 지원한다(이 앱은 54).
// iOS 는 Detox 20 부터 앱 코드 수정 없이 붙으므로 먼저 여기부터 세운다.
//
// ios/ 는 gitignore 된 Expo CNG 산출물이다 — 없으면 `npx expo prebuild -p ios` 로 만든 뒤
// `npm run e2e:build` 를 돌린다.
module.exports = {
  testRunner: {
    args: {
      $0: "jest",
      config: "e2e/jest.config.js",
    },
    jest: {
      setupTimeout: 180_000,
    },
  },
  apps: {
    "ios.debug": {
      type: "ios.app",
      binaryPath: "ios/build/Build/Products/Debug-iphonesimulator/tastic.app",
      // 시뮬레이터 빌드라 코드사인이 필요 없다(CODE_SIGNING_ALLOWED=NO).
      // 로그 포매터(xcbeautify)는 설치를 강제하지 않기 위해 붙이지 않는다.
      build:
        "xcodebuild -workspace ios/tastic.xcworkspace -scheme tastic -configuration Debug " +
        "-sdk iphonesimulator -derivedDataPath ios/build " +
        "-destination 'generic/platform=iOS Simulator' " +
        "CODE_SIGNING_ALLOWED=NO",
    },
    // E2E 의 기본 구성. 디버그 빌드는 expo-dev-client 런처("개발 서버 고르기") 화면에서
    // 멈춰 Detox 가 앱 화면을 영영 못 찾는다. Release 는 JS 번들이 앱에 박혀 있어
    // 런처도 Metro 도 필요 없고, 실행 경로가 실제 배포본과 같아 결과도 더 믿을 만하다.
    "ios.release": {
      type: "ios.app",
      binaryPath: "ios/build-release/Build/Products/Release-iphonesimulator/tastic.app",
      build:
        "xcodebuild -workspace ios/tastic.xcworkspace -scheme tastic -configuration Release " +
        "-sdk iphonesimulator -derivedDataPath ios/build-release " +
        "-destination 'generic/platform=iOS Simulator' " +
        "CODE_SIGNING_ALLOWED=NO",
    },
  },
  devices: {
    simulator: {
      type: "ios.simulator",
      device: {
        type: "iPhone 17",
      },
    },
  },
  configurations: {
    // 기본 — 실제 배포본과 같은 실행 경로
    "ios.sim.release": {
      device: "simulator",
      app: "ios.release",
    },
    // 디버깅용(Metro 연결 필요, dev-client 런처를 수동으로 통과해야 함)
    "ios.sim.debug": {
      device: "simulator",
      app: "ios.debug",
    },
  },
};
