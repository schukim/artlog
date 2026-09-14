import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { enforceRateLimit } from "../_shared/usage.ts";
import { consumeGuestUsage, guestIdFrom } from "../_shared/guest.ts";
import {
  buildSourceList,
  CORS,
  formatStep,
  searchQueries,
  searchStep,
  SOURCE_WHITELIST,
  STR_ARRAY,
  STR_OR_NULL,
  strictObject,
  type Trace,
} from "../_shared/websearch.ts";

// 유저별 작품 검색 일일 상한(비용 남용 방어). 정상 사용자는 하루 수 건, 이 값은 abuse ceiling.
const SEARCH_RATE_LIMIT_PER_DAY = 40;

// ── 시간 예산 ──
// 클라이언트 타임아웃은 35초(src/services/claude.ts). 콜드스타트·네트워크 전송 여유를
// 남겨 28초를 서버 전체 예산으로 잡는다. 별칭 패스는 "있으면 좋은" 보조 경로이므로,
// 예산이 모자라면 시작하지 않고 1패스 결과를 그대로 돌려준다 —
// 클라이언트가 타임아웃으로 아무것도 못 받는 것보다 낫다.
const TOTAL_BUDGET_MS = 28_000;
// 별칭 해석(원제 문자열만 알아내는 짧은 질의) 상한. 실측 ~6초.
const ALIAS_RESOLVE_BUDGET_MS = 9_000;
// 찾은 원제로 화이트리스트 검색을 다시 도는 2패스 상한. 실측 ~11초.
const ALIAS_RESEARCH_BUDGET_MS = 13_000;
// 응답 직렬화·전송 몫으로 남겨두는 여유.
const RESPONSE_RESERVE_MS = 1_500;

// 글로벌 콘텐츠 캐시: 동일/유사 작품을 다른 유저가 검색하면 웹서치를 스킵하고
// 기존 신뢰 작품(works.is_verified=true 또는 외부 ingestion)의 메타데이터를 재사용한다.
// service_role로 RLS를 우회해 전체 카탈로그를 조회한다.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// 새 API 키 체계 프로젝트에선 SUPABASE_SERVICE_ROLE_KEY가 함수 env에 자동 주입되지 않을 수 있어,
// 명시적 시크릿 SB_SERVICE_ROLE_KEY를 우선 사용하고 없으면 자동 주입분으로 폴백한다.
const SERVICE_ROLE_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// ── 캐시 임계값 2단 ──
// 확정선(0.85): 사실상 같은 작품으로 보고 confidence "high" 로 돌려준다. 기존 동작.
const CACHE_SIMILARITY_THRESHOLD = 0.85;
// 노출선(0.75): 확신은 없지만 "혹시 이 작품인가요?"로 **제안**하는 구간.
// 이 구간은 confidence "medium" 으로 내려 클라이언트가 자동 선택하지 않게 하고,
// 화면에도 제안임을 알리는 문구를 띄운다 — 판단은 제목을 읽는 사람이 한다.
//
// 왜 자동 확정선을 낮추지 않고 구간을 나눴나: trigram 점수는 제목 길이에 휘둘린다.
// 같은 's' 하나 차이가 'cat/cats' 0.50, 'feel so good/feels so good' 0.80,
// 'shawshank/shawshanks' 0.88 이다. 한 임계값으로 "같은 작품"을 판정할 수 없다.
// 실측상 이 구간엔 동일작(0.80)과 시즌 다른 작품(피의 게임/피의 게임 3, 0.75)이 함께 산다 —
// 기계는 못 가르지만 사람은 제목만 보고 가른다.
const CACHE_SUGGEST_THRESHOLD = 0.75;

// ── 질의 메모 캐시 TTL ──
// works 캐시가 "작품"을 기억한다면 이쪽은 "유저가 친 문자열"을 기억한다. 확정까지 가지 않은
// 검색도 학습되므로, 같은 문자열의 2회차부터는 웹서치 비용이 0이 된다.
// 찾은 결과는 오래 유효하다(작품 메타데이터는 거의 변하지 않는다).
const MEMO_TTL_DAYS_FOUND = 90;
// "못 찾음"은 짧게 — 신작이 며칠 뒤 신뢰 소스에 올라올 수 있다. 그래도 반복 과금은 막는다.
const MEMO_TTL_DAYS_EMPTY = 3;
// 메모 조회가 지연돼도 전체 예산을 먹지 않게 하는 자체 상한.
const MEMO_TIMEOUT_MS = 2_000;

// deno-lint-ignore no-explicit-any
let _sb: any = null;
function supabase() {
  if (!_sb) _sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  return _sb;
}

// ── 질의 메모 캐시 ──
// 키는 유저가 실제로 친 문자열(+카테고리·언어·창작자 힌트)이고, 매칭은 정규화 후 완전일치다.
// 유사도 판정을 쓰지 않는 이유: 실측상 오타↔정답이 0.80, 1편↔속편이 0.87 이라
// 붙여야 할 쌍보다 떼야 할 쌍의 점수가 높다 — 안전한 임계값이 존재하지 않는다.
// 완전일치라 속편을 1편으로 흡수할 여지가 구조적으로 없다.

// deno-lint-ignore no-explicit-any
async function withTimeout<T>(p: PromiseLike<T>, ms: number, fallback: any): Promise<T> {
  return (await Promise.race([
    p,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])) as T;
}

function memoLang(language: unknown): string {
  return language === "en" ? "en" : "ko";
}

// 히트하면 candidates 배열, 미스면 null. 어떤 실패도 미스로 처리한다(웹서치로 폴백).
async function memoGet(
  title: string,
  category: string,
  language: unknown,
  creator: string | undefined,
): Promise<unknown[] | null> {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
    const { data, error } = await withTimeout(
      supabase().rpc("search_memo_get", {
        p_query: title,
        p_category: category,
        p_language: memoLang(language),
        p_creator: creator ?? null,
      }),
      MEMO_TIMEOUT_MS,
      { data: null, error: { message: "memo lookup timeout" } },
    );
    if (error) {
      console.error("memoGet error:", error);
      return null;
    }
    return Array.isArray(data) ? data : null;
  } catch (e) {
    console.error("memoGet failed — 웹서치로 폴백:", e);
    return null;
  }
}

// 웹서치가 끝난 뒤 결과를 적재. 빈 결과도 저장한다 — "못 찾음"의 반복이 곧 반복 과금이다.
// 적재 실패는 응답을 막지 않는다(다음 호출이 다시 웹서치할 뿐).
async function memoPut(
  title: string,
  category: string,
  language: unknown,
  creator: string | undefined,
  candidates: unknown[],
): Promise<void> {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
    const { error } = await withTimeout(
      supabase().rpc("search_memo_put", {
        p_query: title,
        p_category: category,
        p_candidates: candidates,
        p_language: memoLang(language),
        p_creator: creator ?? null,
        p_ttl_days: candidates.length > 0 ? MEMO_TTL_DAYS_FOUND : MEMO_TTL_DAYS_EMPTY,
      }),
      MEMO_TIMEOUT_MS,
      { error: { message: "memo put timeout" } },
    );
    if (error) console.error("memoPut error:", error);
  } catch (e) {
    console.error("memoPut failed:", e);
  }
}

// search_works RPC로 카탈로그를 훑어, 신뢰할 수 있는 캐시 작품이 있으면 candidate로 합성해 반환.
// 없으면 null → 호출부에서 웹서치로 폴백.
async function lookupCache(title: string, category: string) {
  // 캐시 조회는 절대 함수를 죽이면 안 된다 — 어떤 실패(키 누락·RPC 에러·지연)든 null 반환 후 웹서치로 폴백.
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error("lookupCache: service-role env 누락 — 캐시 비활성, 웹서치로 폴백");
      return null;
    }
    // 임베딩을 넘기지 않으므로 제목 trigram 유사도만으로 0~1 스케일이 되도록 가중치를 조정한다.
    // (기본값 trigram 0.4 / embedding 0.6이면 임베딩 없는 호출은 점수가 최대 0.55로 묶여 0.85 도달 불가)
    // 캐시 조회가 느리거나 멈춰도 전체 예산을 먹지 않도록 3초 자체 타임아웃 후 웹서치로 폴백.
    const rpc = supabase().rpc("search_works", {
      query_text: title,
      target_category: category,
      trigram_weight: 1.0,
      embedding_weight: 0.0,
      limit_count: 5,
    });
    const timeout = new Promise<{ data: null; error: { message: string } }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: { message: "cache lookup timeout" } }), 3000)
    );
    // deno-lint-ignore no-explicit-any
    const { data, error } = (await Promise.race([rpc, timeout])) as any;
    if (error) {
      console.error("lookupCache search_works error:", error);
      return null;
    }
    // search_works 는 유사도 내림차순으로 최대 5행을 준다.
    // 예전엔 맨 앞 한 행만 보고 판정했는데, 수동입력으로 생긴 비신뢰 행이 오타 제목과
    // 1.00 으로 붙어 맨 앞에 서면 2번째의 진짜 신뢰 행을 보지도 못하고 웹서치로 떨어졌다
    // (실측: 'Feel so good' → 비신뢰 1.00 / 'Feels So Good' 신뢰 0.80 → 매번 재검색).
    // 이제 신뢰 행 중 임계 이상인 첫 행을 고른다 — 정렬이 점수순이므로 첫 행이 곧 최선.
    // deno-lint-ignore no-explicit-any
    const rows = (data ?? []) as any[];
    const best = rows.find(
      (r) =>
        (r.is_verified === true || r.primary_source != null) &&
        r.similarity_score >= CACHE_SUGGEST_THRESHOLD
    );
    if (!best) return null;
    // 확정선 미만은 "제안"이다 — confidence 를 내려 클라이언트가 미리 선택하지 않게 한다.
    const suggested = best.similarity_score < CACHE_SIMILARITY_THRESHOLD;
    const candidate = {
      title: best.title,
      original_title: best.original_title ?? null,
      creator: best.creator ?? null,
      year: best.year ?? null,
      genre: best.genre ?? null,
      metadata: best.metadata ?? {},
      confidence: suggested ? "medium" : "high",
    };
    return {
      candidate,
      source_work_id: best.id as string,
      similarity: best.similarity_score as number,
      suggested,
      // 0 이 아니면 앞선 비신뢰 행에 가려져 있던 히트 — 그림자 발생 빈도 추적용
      rank: rows.indexOf(best),
    };
  } catch (e) {
    console.error("lookupCache failed — 웹서치로 폴백:", e);
    return null;
  }
}

function buildMetadataSchema(category: string): string {
  switch (category) {
    case "movie":
      return `metadata 필드 구조 (영화):
{
  "creator_style": "감독 고유의 연출 방식 — 편집 리듬, 카메라 무브먼트, 장면 구성, 색채 등 구체적으로 서술. 장르명 단독 사용 금지 (string | null)",
  "cast": ["주요 배우 이름 배열, 최대 5명"],
  "synopsis": "한 줄 시놉시스 (string | null)",
  "keywords": ["이 영화만의 감정적 분위기·주제의식·서사 특성 키워드. 제목·감독명·배우명·장르명은 절대 포함하지 말 것. 최소 1개 이상 (예: '냉소적 유머', '비선형 구조', '계급 갈등')"]
}`;
    case "music":
      return `metadata 필드 구조 (음악 — 앨범/곡 구분 필수):
앨범인 경우:
{
  "music_type": "album",
  "creator_style": "아티스트 고유의 음악적 접근 방식 — 제작 방식, 사운드 질감, 보컬 스타일, 가사 서사 등을 구체적으로 서술. 장르명 단독 사용 금지 (string | null)",
  "track_count": number | null,
  "keywords": ["이 앨범만의 감정적 분위기·소닉 특성·주제의식 키워드. 아티스트명·앨범명·장르명은 절대 포함하지 말 것. 최소 1개 이상 (예: '새벽 감성', '레이어드 사운드', '자기 성찰')"]
}
곡인 경우:
{
  "music_type": "song",
  "creator_style": "아티스트 고유의 음악적 접근 방식 — 제작 방식, 사운드 질감, 보컬 스타일, 가사 서사 등을 구체적으로 서술. 장르명 단독 사용 금지 (string | null)",
  "release_format": "앨범 수록 또는 싱글 (string | null)",
  "keywords": ["이 곡만의 감정적 분위기·소닉 특성·주제의식 키워드. 아티스트명·곡명·장르명은 절대 포함하지 말 것. 최소 1개 이상 (예: '이별 직후의 공허함', '몽환적 베이스라인', '반복 후렴')"]
}
※ 사용자가 명시하지 않으면 music_type은 "album"으로 기본 설정`;
    case "book":
      return `metadata 필드 구조 (책 — 소설/비소설 구분 필수):
소설 · 스토리인 경우:
{
  "book_type": "fiction",
  "creator_style": "저자 고유의 문체 특성 — 문장 길이·밀도, 감정 처리 방식, 서술 거리 등을 구체적으로 서술. 장르명 단독 사용 금지 (string | null)",
  "setting": "배경 (시대 + 장소) (string | null)",
  "perspective": "시점 (1인칭, 3인칭 등) (string | null)",
  "keywords": ["이 소설만의 감정적 분위기·서사 특성·주제의식 키워드. 제목·저자명·장르명은 절대 포함하지 말 것. 최소 1개 이상 (예: '실존적 불안', '섬세한 심리묘사', '느린 전개')"]
}
비소설 · 자기계발 · 이론 · 에세이인 경우:
{
  "book_type": "nonfiction",
  "creator_style": "저자 고유의 서술 방식 — 논증 구조, 예시 활용 방식, 독자 호명 스타일 등을 구체적으로 서술. 분야명 단독 사용 금지 (string | null)",
  "field": "분야 (심리학, 경제, 철학 등) (string | null)",
  "core_argument": "핵심 주장/논지 한 줄 (string | null)",
  "keywords": ["이 책만의 핵심 개념·주제 키워드. 제목·저자명·분야명은 절대 포함하지 말 것. 최소 1개 이상 (예: '습관 루프', '작은 행동의 복리', '정체성 기반 변화')"]
}`;
    case "art":
      return `metadata 필드 구조 (미술):
{
  "creator_style": "작가 고유의 조형 언어 — 색채 사용, 구성 방식, 붓질·질감, 표현 특성 등을 구체적으로 서술. 사조명 단독 사용 금지 (string | null)",
  "medium": "매체/기법 (유화, 설치미술, 사진 등) (string | null)",
  "movement": "예술 사조 (인상주의, 팝아트 등) (string | null)",
  "keywords": ["이 작품만의 감정적 분위기·시각적 특성·주제의식 키워드. 작품명·작가명·사조명은 절대 포함하지 말 것. 최소 1개 이상 (예: '멜랑꼴리', '왜곡된 원근법', '소비사회 비판')"]
}`;
    case "series":
      return `metadata 필드 구조 (시리즈/드라마):
{
  "creator_style": "감독/크리에이터 고유의 연출 방식 — 편집 리듬, 장면 구성, 캐릭터 서사 전개 방식 등을 구체적으로 서술. 장르명 단독 사용 금지 (string | null)",
  "cast": ["주요 배우 이름 배열, 최대 5명"],
  "synopsis": "한 줄 시놉시스 (string | null)",
  "keywords": ["이 시리즈만의 감정적 분위기·서사 특성·주제의식 키워드. 제목·감독명·배우명·장르명은 절대 포함하지 말 것. 최소 1개 이상 (예: '긴장된 침묵', '가족 내 권력 구도', '느린 빌드업')"]
}
※ 창작자(감독/크리에이터), 장르, 발표 연도는 별도 필드로 저장하므로 metadata에 포함하지 말 것`;
    default:
      return `metadata 필드 구조:\n{}`;
  }
}

// ── Structured Outputs 스키마 (해결책 1) ──
// 카테고리별 metadata는 strict 모드 제약(모든 키 required + additionalProperties:false)을 지킨다.
// nullable은 type:["string","null"], 분기형(music/book)은 anyOf로 표현한다.
// (STR_OR_NULL / STR_ARRAY / strictObject 는 _shared/websearch.ts 에서 import)
function buildMetadataJsonSchema(category: string): Record<string, unknown> {
  switch (category) {
    case "movie":
    case "series":
      return strictObject({
        creator_style: STR_OR_NULL,
        cast: STR_ARRAY,
        synopsis: STR_OR_NULL,
        keywords: STR_ARRAY,
      });
    case "art":
      return strictObject({
        creator_style: STR_OR_NULL,
        medium: STR_OR_NULL,
        movement: STR_OR_NULL,
        keywords: STR_ARRAY,
      });
    case "music":
      return {
        anyOf: [
          strictObject({
            music_type: { type: "string", enum: ["album"] },
            creator_style: STR_OR_NULL,
            track_count: { type: ["integer", "null"] },
            keywords: STR_ARRAY,
          }),
          strictObject({
            music_type: { type: "string", enum: ["song"] },
            creator_style: STR_OR_NULL,
            release_format: STR_OR_NULL,
            keywords: STR_ARRAY,
          }),
        ],
      };
    case "book":
      return {
        anyOf: [
          strictObject({
            book_type: { type: "string", enum: ["fiction"] },
            creator_style: STR_OR_NULL,
            setting: STR_OR_NULL,
            perspective: STR_OR_NULL,
            keywords: STR_ARRAY,
          }),
          strictObject({
            book_type: { type: "string", enum: ["nonfiction"] },
            creator_style: STR_OR_NULL,
            field: STR_OR_NULL,
            core_argument: STR_OR_NULL,
            keywords: STR_ARRAY,
          }),
        ],
      };
    default:
      return strictObject({});
  }
}

function buildResponseJsonSchema(category: string): Record<string, unknown> {
  const candidate = strictObject({
    title: { type: "string" },
    original_title: STR_OR_NULL,
    creator: STR_OR_NULL,
    year: { type: ["integer", "null"] },
    genre: STR_OR_NULL,
    metadata: buildMetadataJsonSchema(category),
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  });
  return strictObject({
    candidates: { type: "array", items: candidate },
  });
}

// ── 검색어 변형 힌트 ──
// 한국어 제목은 띄어쓰기 표기가 갈린다("싱어게인" vs "싱 어게인"). 모델에게 "변형해 보라"고
// 말로 시키면 잘 안 하므로, 서버가 실제 문자열을 계산해 프롬프트에 박아 넣는다.
function spacingVariants(title: string): string[] {
  const t = title.trim();
  const out = new Set<string>();
  if (/\s/.test(t)) {
    out.add(t.replace(/\s+/g, "")); // "싱 어게인" → "싱어게인"
  } else if (/[가-힣]/.test(t) && t.length >= 3) {
    // 공백 없는 한글 제목: 가능한 모든 분절 지점을 시도한다.
    // 1글자 조각을 배제하면 안 된다 — "싱어게인" → "싱 어게인"이 바로 그 경우다.
    for (let i = 1; i <= t.length - 1; i++) out.add(`${t.slice(0, i)} ${t.slice(i)}`);
  }
  out.delete(t);
  return [...out].slice(0, 4);
}

function hasHangul(s: string): boolean {
  return /[가-힣]/.test(s);
}

// ── 1단계 프롬프트 조립 ──
// aliases 가 있으면(별칭 해석 패스 B) 원제 후보를 검색어로 함께 제시한다.
function buildSearchPrompt(params: {
  title: string;
  creator?: string;
  category: string;
  sourceList: string;
  metadataSchema: string;
  aliases: string[];
}): string {
  const { title, creator, category, sourceList, metadataSchema, aliases } = params;
  const creatorLine = creator ? `창작자 힌트: ${creator}\n` : "";
  const variants = spacingVariants(title);

  // 검색 전략을 "포기하지 말고"류의 권고가 아니라 번호가 매겨진 최소 실행 목록으로 준다.
  const queryPlan = [
    `① 제목 원문 그대로: "${title}"`,
    variants.length ? `② 띄어쓰기 변형: ${variants.map((v) => `"${v}"`).join(", ")}` : null,
    creator ? `③ 창작자 결합: "${title} ${creator}"` : `③ 창작자·연도 결합: "${title} ${category}"`,
    hasHangul(title)
      ? `④ 추정 원제/영문 표기: 이 작품의 원제나 영문 제목을 추정해 그것으로도 검색`
      : `④ 한국어 표기: 이 작품의 한국어 제목을 추정해 그것으로도 검색`,
    aliases.length ? `⑤ 확인된 원제 후보(우선 사용): ${aliases.map((a) => `"${a}"`).join(", ")}` : null,
  ].filter(Boolean).join("\n");

  const sourceBlock = sourceList
    ? `\nweb_search는 아래 신뢰 소스 도메인으로만 검색되도록 이미 제한되어 있다(별도로 site: 를 붙이지 말 것).

검색 실행 규칙 (반드시 지킬 것):
- 아래 검색어 계획을 순서대로 실행하되, **최소 2회 이상 서로 다른 질의로 검색**해야 한다. 1회 검색으로 끝내지 마라.
- 첫 질의에서 결과가 나와도, 그것이 다른 작품일 수 있으므로 최소 한 번은 다른 형태로 교차 확인하라.
- 핵심 정보(창작자·발표 연도)는 가능하면 2개 이상의 소스에서 교차 확인하라.

검색어 계획:
${queryPlan}

검색 대상 신뢰 소스 (${category}):
${sourceList}
`
    : "";

  const aliasNote = aliases.length
    ? `\n참고: 사전 조사에서 이 제목의 원제/다른 표기가 다음으로 확인되었다 — ${aliases.join(", ")}. 이 표기를 우선 검색어로 사용하라.\n`
    : "";

  return `너는 문화 콘텐츠 식별 전문가다.
web_search를 사용해 아래 작품을 조사하라.

규칙:
- 창작자 힌트가 있으면 해당 창작자의 작품을 우선 탐색
- 동일 제목의 작품이 여러 개 있으면 최대 5개까지 조사
- 확신할 수 없는 정보는 "불명"으로 표시 (추측 금지)
- 작품을 전혀 찾을 수 없으면 "식별 불가"라고 분명히 밝혀라
${sourceBlock}${aliasNote}
조사가 끝나면 각 후보에 대해 아래 항목을 사실 위주로 정리해 보고하라(서술 형식은 자유):
제목 / 원제 / 창작자 / 발표 연도 / 장르 / 확신도(high·medium·low)
그리고 카테고리별 특성:
${metadataSchema}

제목: ${title}
카테고리: ${category}
${creatorLine}`;
}

// ── 별칭(원제) 해석 패스 ──
// 화이트리스트 검색이 실패하는 대표 원인은 "한국어 제목으로는 신뢰 소스에 안 걸리는" 경우다.
// 여기서는 도메인 필터를 풀고(나무위키·네이버 등 도달 허용) **원제 문자열만** 알아낸다.
// 알아낸 원제로 다시 화이트리스트 검색을 돌리므로, 사실 확정은 여전히 신뢰 소스에서만 이뤄진다.
// 환각 방어선(2단계 strict JSON)도 그대로다 — 이 패스의 산출물은 검색어일 뿐 사실이 아니다.
async function resolveAliases(
  title: string,
  category: string,
  creator: string | undefined,
  country: string | undefined,
  budgetMs: number,
): Promise<{ aliases: string[]; trace: Trace | null; timedOut: boolean }> {
  // 조사·정형화 두 호출로 예산을 나눈다. 조사가 무겁고 정형화는 짧다.
  const searchMs = Math.max(3_000, Math.round(budgetMs * 0.7));
  const formatMs = Math.max(2_000, budgetMs - searchMs);
  try {
    const variants = spacingVariants(title);
    const prompt = `아래 작품의 **다른 표기(원제·영문 제목·정식 표기)만** 알아내라. 줄거리·평가·상세 정보는 필요 없다.

제목: ${title}
카테고리: ${category}
${creator ? `창작자 힌트: ${creator}\n` : ""}${variants.length ? `참고: 띄어쓰기 변형 표기 — ${variants.join(", ")}\n` : ""}
web_search로 검색해 다음을 찾아라:
- 이 한국어 제목에 대응하는 원제(외국 작품이면 원어 제목)
- 영문 표기 / 로마자 표기
- 국내 정식 명칭이 따로 있다면 그것
- 띄어쓰기·표기가 다른 공식 명칭

찾은 표기들을 나열해 보고하라. 확실하지 않으면 나열하지 마라.`;

    // 도메인 필터 없음(빈 배열) — 별칭 해석 전용. 짧은 질의라 출력 토큰을 줄인다.
    const { findings, trace } = await searchStep(prompt, [], {
      country,
      maxOutputTokens: 768,
      timeoutMs: searchMs,
    });

    const { parsed } = await formatStep(
      `아래 조사 결과에서 이 작품의 다른 표기(원제·영문 제목·정식 표기)만 문자열 배열로 뽑아라.

규칙:
- 조사 결과에 실제로 등장한 표기만 넣을 것. 추측·번역 생성 금지
- 원래 입력 제목("${title}")과 동일한 문자열은 넣지 말 것
- 확실한 표기가 없으면 빈 배열([])
- 최대 4개

조사 결과:
"""
${findings}
"""`,
      strictObject({ aliases: STR_ARRAY }),
      trace,
      "title_aliases",
      { timeoutMs: formatMs },
    );

    const raw = (parsed as { aliases?: unknown })?.aliases;
    const aliases = Array.isArray(raw)
      ? [...new Set(
          raw
            .filter((a): a is string => typeof a === "string")
            .map((a) => a.trim())
            .filter((a) => a.length > 0 && a.toLowerCase() !== title.trim().toLowerCase()),
        )].slice(0, 4)
      : [];
    return { aliases, trace, timedOut: false };
  } catch (e) {
    // 별칭 패스는 보조 경로다 — 실패해도(타임아웃 포함) 전체를 죽이지 않고 1패스 결과를 그대로 쓴다.
    const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
    console.error(`verify-content alias pass ${timedOut ? "timed out" : "failed"}:`, e);
    return { aliases: [], trace: null, timedOut };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { ...CORS } });
  }

  try {
    const { title, creator, category, language, skipCache, retry } = await req.json();
    const t0 = Date.now();

    // ── 0단계: 글로벌 캐시 조회 ──
    // skipCache=true('재검색')면 건너뛰고 바로 웹서치. 아니면 캐시 히트 시 웹서치 스킵.
    if (!skipCache) {
      // 0-a. 질의 메모 — 같은 문자열을 전에 검색한 적이 있으면 그 결과를 그대로 돌려준다.
      // 확정까지 가지 않은 검색도 여기 남으므로, 반복 검색은 2회차부터 비용이 0이다.
      const memo = await memoGet(title, category, language, creator);
      if (memo) {
        const ms = Date.now() - t0;
        console.log("verify-content memo hit:", JSON.stringify({
          title, category, ms, count: memo.length,
        }));
        return new Response(
          JSON.stringify({
            candidates: memo,
            _debug: {
              // 클라이언트는 이 값으로 '재검색' 버튼을 띄운다 — 메모 결과도 갱신 가능해야 한다.
              cache_hit: true,
              memo_hit: true,
              ms,
              search_count: 0,
              cited_domains: [],
            },
          }),
          { headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // 0-b. works 카탈로그 캐시 (기존 경로)
      const hit = await lookupCache(title, category);
      if (hit) {
        const ms = Date.now() - t0;
        console.log("verify-content cache hit:", JSON.stringify({
          title, category, ms, source_work_id: hit.source_work_id, similarity: hit.similarity,
          rank: hit.rank, suggested: hit.suggested,
        }));
        return new Response(
          JSON.stringify({
            candidates: [hit.candidate],
            _debug: {
              cache_hit: true,
              // 확정이 아니라 제안임 — 클라이언트가 "이 작품이 맞나요?" 문구를 띄운다.
              // 이 구간 히트를 사용자가 실제로 골랐는지 로그로 추적해 0.75를 조정한다.
              suggested: hit.suggested,
              ms,
              source_work_id: hit.source_work_id,
              similarity: hit.similarity,
              search_count: 0,
              cited_domains: [],
            },
          }),
          { headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }
    }

    // 캐시 미스 → 실제 웹서치(OpenAI 비용) 직전에만 일일 상한 검사.
    // 캐시 히트는 비용이 없으므로 카운트하지 않는다.
    // 게스트(비로그인 체험)는 JWT 가 없으므로 기기 UUID + 전역 상한으로 별도 게이트를 탄다.
    const guestId = await guestIdFrom(req);
    if (guestId) {
      const guestGate = await consumeGuestUsage(guestId, "search", CORS, language);
      if (!guestGate.ok) return guestGate.response;
    } else {
      const gate = await enforceRateLimit(req, "search", SEARCH_RATE_LIMIT_PER_DAY, CORS, language);
      if (!gate.ok) return gate.response;
    }

    const lang = language === "ko" ? "한국어" : "English";
    const metadataSchema = buildMetadataSchema(category);
    const sourceList = buildSourceList(category);
    // 검색을 강제 제한할 도메인 (allowed_domains 필터). 모델이 임의로 site:로 더 좁히지 못하게 한다.
    const allowedDomains = (SOURCE_WHITELIST[category] ?? []).map((s) => s.domain);
    // 한국어 사용자는 KR 로케일로 검색 — 국내 개봉명·방송명이 상위로 올라온다.
    const country = language === "ko" ? "KR" : undefined;

    // 남은 시간 예산. 1패스가 오래 걸리면 보조 경로를 아예 시작하지 않기 위한 기준.
    const remainingMs = () => TOTAL_BUDGET_MS - (Date.now() - t0) - RESPONSE_RESERVE_MS;

    // 조사(1단계) → 정형화(2단계) 한 바퀴. 별칭 패스에서 원제를 얻으면 같은 함수를 다시 돈다.
    // budgetMs 를 주면 두 호출에 나눠 상한을 건다(1패스는 상한 없이 — 이게 본 경로다).
    const runPass = async (aliases: string[], budgetMs?: number) => {
      const searchMs = budgetMs ? Math.max(3_000, Math.round(budgetMs * 0.7)) : undefined;
      const formatMs = budgetMs ? Math.max(2_000, budgetMs - (searchMs ?? 0)) : undefined;
      const searchPrompt = buildSearchPrompt({
        title, creator, category, sourceList, metadataSchema, aliases,
      });
      const { findings, trace } = await searchStep(searchPrompt, allowedDomains, {
        country,
        timeoutMs: searchMs,
      });

      // ── 2단계 프롬프트: 조사 결과를 strict JSON으로 정형화 ──
      const formatPrompt = `아래 "조사 결과"를 content_candidates JSON 스키마에 맞춰 변환하라.

규칙:
- 조사 결과에 근거해서만 채울 것. 조사 결과에 없는 정보를 추측·창작하지 말 것
- 확신할 수 없는 필드는 null
- keywords는 각 후보마다 최소 1개 이상
- 조사 결과가 "식별 불가"이거나 유효한 후보가 없으면 candidates를 빈 배열([])로 둘 것
- 모든 서술형 텍스트는 ${lang}로 작성

카테고리별 metadata 작성 지침:
${metadataSchema}

조사 결과:
"""
${findings}
"""

원본 입력 — 제목: ${title} / 카테고리: ${category}`;

      const { parsed } = await formatStep(
        formatPrompt, buildResponseJsonSchema(category), trace, "content_candidates",
        { timeoutMs: formatMs },
      );
      return { parsed, trace, findings };
    };

    let { parsed, trace, findings } = await runPass([]);
    let aliases: string[] = [];
    let aliasAttempted = false;
    // 진단용 — 별칭 패스가 왜 결과에 반영되지 않았는지 로그로 구분한다.
    let aliasOutcome: "not_needed" | "no_budget" | "timeout" | "no_aliases" | "no_result" | "applied" =
      "not_needed";

    // ── 별칭 해석 2패스 ──
    // 1패스가 빈손이거나, 사용자가 '재검색'을 눌러 retry=true 로 왔을 때만 추가 비용을 쓴다.
    const firstCount = (parsed as { candidates?: unknown[] })?.candidates?.length ?? 0;
    if (firstCount === 0 || retry === true) {
      // 예산이 별칭 해석분도 안 되면 시작하지 않는다. 반쯤 하다 끊기면 시간만 버리고
      // 클라이언트 타임아웃을 유발한다 — 1패스 결과를 그대로 주는 편이 항상 낫다.
      if (remainingMs() < ALIAS_RESOLVE_BUDGET_MS) {
        aliasOutcome = "no_budget";
      } else {
        aliasAttempted = true;
        const resolved = await resolveAliases(
          title, category, creator, country,
          Math.min(ALIAS_RESOLVE_BUDGET_MS, remainingMs()),
        );
        aliases = resolved.aliases;
        if (resolved.timedOut) {
          aliasOutcome = "timeout";
        } else if (aliases.length === 0) {
          aliasOutcome = "no_aliases";
        } else if (remainingMs() < 5_000) {
          // 원제는 찾았지만 재검색을 돌릴 시간이 없다.
          aliasOutcome = "no_budget";
        } else {
          const budget = Math.min(ALIAS_RESEARCH_BUDGET_MS, remainingMs());
          try {
            const second = await runPass(aliases, budget);
            const secondCount = (second.parsed as { candidates?: unknown[] })?.candidates?.length ?? 0;
            // 2패스가 실제로 후보를 찾았을 때만 교체한다 — 빈손이면 1패스 결과를 지키는 게 낫다.
            if (secondCount > 0) {
              parsed = second.parsed;
              trace = second.trace;
              findings = second.findings;
              aliasOutcome = "applied";
            } else {
              aliasOutcome = "no_result";
            }
          } catch (e) {
            const t = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
            aliasOutcome = t ? "timeout" : "no_result";
            console.error(`verify-content alias re-search ${t ? "timed out" : "failed"}:`, e);
          }
        }
      }
    }

    // ── 메모 적재 ──
    // 웹서치를 실제로 돌린 경우에만 도달한다. 빈 결과도 저장한다 — 같은 문자열을 다시 쳐도
    // 또 웹서치하는 것이 이번 사건(오타 1건 4회 검색)의 직접 원인이었다.
    // skipCache('재검색')로 온 요청도 여기서 덮어쓰므로 낡은 메모가 갱신된다.
    const finalCandidates = (parsed as { candidates?: unknown[] })?.candidates ?? [];
    await memoPut(title, category, language, creator, finalCandidates);

    trace.ms = Date.now() - t0; // 전체 합산

    console.log("verify-content trace:", JSON.stringify({
      title, category,
      ms: trace.ms,
      search_count: trace.search_count,
      // 실제로 던진 검색 질의 — 실패 원인 분석에 가장 필요한 정보
      queries: searchQueries(trace),
      cited_domains: trace.cited_domains,
      candidate_count: (parsed as { candidates?: unknown[] })?.candidates?.length ?? 0,
      alias_attempted: aliasAttempted,
      alias_outcome: aliasOutcome,
      aliases,
      retry: retry === true,
      format_status: trace.format_status,
      incomplete_reason: trace.incomplete_reason,
      findings_head: (findings ?? "").slice(0, 300),
    }));

    return new Response(
      JSON.stringify({
        ...parsed,
        _debug: { ...trace, aliases, alias_attempted: aliasAttempted, alias_outcome: aliasOutcome },
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const trace = (error as { trace?: unknown }).trace ?? { error: String(error) };
    console.error("verify-content error:", error, JSON.stringify(trace));
    return new Response(
      JSON.stringify({
        error: "generation_failed",
        message: "작품을 검색하지 못했습니다.",
        _debug: trace,
      }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
