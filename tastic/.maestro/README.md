# E2E (Maestro)

평론 플로우는 이 앱의 심장이고, 회귀가 나면 사용자가 10~20분짜리 인터뷰 결과를 잃는다.
그 경로를 자동으로 지키기 위한 E2E다.

## 왜 Detox 가 아니라 Maestro 인가

이 앱은 Expo SDK 54 / RN 0.81 이라 **New Architecture(Fabric)** 로 돈다.
Detox 는 Fabric 에서 가시성 판정이 깨진다 — 화면 전체를 덮는 루트 뷰조차
`visible: false / hittable: false` 로 나오고, 요소 조회는 되는데 **탭이 전부 실패**한다
(`View does not pass visibility percent threshold`). 실제로 돌려보고 확인한 사실이다.

Maestro 는 접근성 계층으로 구동해 Fabric 에서 정상 동작한다. `testID` 는 그대로 쓰인다.

## 준비

```bash
# 1. Maestro (Java 17+ 필요 — 시스템 Java 가 11 이면 아래처럼 21 을 따로 깐다)
curl -Ls "https://get.maestro.mobile.dev" | bash
brew install openjdk@21
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$PATH:$HOME/.maestro/bin"

# 2. 시뮬레이터용 앱 빌드 (Release — 번들이 앱에 박혀 Metro 가 필요 없다)
npx expo prebuild -p ios          # ios/ 가 없을 때만
xcodebuild -workspace ios/tastic.xcworkspace -scheme tastic -configuration Release \
  -sdk iphonesimulator -derivedDataPath ios/build-release \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO

# 3. 시뮬레이터에 설치
xcrun simctl boot "iPhone 17"
xcrun simctl install booted ios/build-release/Build/Products/Release-iphonesimulator/tastic.app
```

> 디버그 빌드는 쓰지 않는다 — expo-dev-client 런처("개발 서버 고르기") 화면에서 멈춰
> 앱 화면에 도달하지 못한다.

## 실행

```bash
npm run e2e:smoke     # 하네스 점검 (계정 불필요)
npm run e2e           # 전체
```

계정이 필요한 플로우는 환경변수로 주입한다. `.maestro/.env` 는 gitignore 돼 있다.

```bash
set -a; . .maestro/.env; set +a
maestro test -e E2E_EMAIL="$E2E_EMAIL" -e E2E_PASSWORD="$E2E_PASSWORD" .maestro/review-save.yaml
```

## 플로우

| 파일 | 검증 대상 | 계정 | LLM 비용 |
|---|---|---|---|
| `smoke.yaml` | 앱 기동·요소 조회·탭 동작 (기준점) | 불필요 | 없음 |
| `login.yaml` | 로그인 서브플로우 | 필요 | 없음 |
| `interview.yaml` | 작품 검색 → 인터뷰 서브플로우 | 필요 | 질문 N회 |
| `review-save.yaml` | **정상 경로** — 인터뷰 → 평론 생성 → 저장 | 필요 | 평론 1회 |
| `review-recover.yaml` | **이탈 확인 다이얼로그 + 복구 카드** | 필요 | 평론 2회 |
| `interview-draft.yaml` | **인터뷰 이탈 → 드래프트 복원** | 필요 | 질문 2회 |

뒤의 셋이 2026-09 에 고친 지점이다. 평론이 저장 전에 사라지던 경로와,
평론 생성이 실패했을 때 돌아갈 길이 없던 문제.

## 테스트 계정

`developer` 플랜을 주면 일일 한도에 걸리지 않는다.

```sql
update users set plan = 'developer' where id = '<계정 uuid>';
```

## 주의

- 플로우가 실제 LLM 을 호출한다. 한 번 완주에 대략 ₩300~400.
- 작품 제목은 이미 캐시에 있는 것을 쓰는 편이 싸다(웹서치를 건너뛴다).
- 앱 코드를 고치면 **반드시 다시 빌드**해야 반영된다(번들이 앱에 박혀 있다).
