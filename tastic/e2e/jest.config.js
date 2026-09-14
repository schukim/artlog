/** @type {import('@jest/types').Config.InitialOptions} */
// Detox 전용 Jest 설정 — 단위 테스트(vitest)와 완전히 분리돼 있다.
// 스펙은 TypeScript 라 ts-jest 로 변환한다(앱 코드를 import 하지 않으므로 babel 설정과 무관).
module.exports = {
  rootDir: "..",
  testMatch: ["<rootDir>/e2e/**/*.e2e.ts"],
  transform: {
    "\\.[jt]sx?$": ["ts-jest", { tsconfig: "<rootDir>/e2e/tsconfig.json" }],
  },
  testTimeout: 180_000,
  maxWorkers: 1,
  globalSetup: "detox/runners/jest/globalSetup",
  globalTeardown: "detox/runners/jest/globalTeardown",
  reporters: ["detox/runners/jest/reporter"],
  testEnvironment: "detox/runners/jest/testEnvironment",
  verbose: true,
};
