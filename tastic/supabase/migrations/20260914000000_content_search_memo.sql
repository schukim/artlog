-- ============================================================
-- 질의 메모 캐시 (ISSUE-016)
--
-- 왜: 지금 캐시(works)는 "작품"을 기억한다. 유저가 검색만 하고 후보를 확정하지 않으면
--     그 검색은 아무 흔적도 남기지 않아, 같은 문자열을 다시 쳐도 처음 보는 질의가 된다.
--     실제로 오타 제목 하나를 4번 검색해 web_search 가 4번 돌았다(1편에 ₩305).
--
-- 무엇: 유저가 실제로 친 문자열을 키로 verify-content 의 최종 후보 배열을 저장한다.
--       "못 찾음"(빈 배열)도 저장한다 — 이번 사건이 바로 "못 찾음 ×4" 였다.
--
-- 왜 유사도가 아니라 완전일치인가: 실측상 오타↔정답이 0.80, 1편↔속편이 0.87 이라
--       붙여야 할 쌍보다 떼야 할 쌍의 점수가 높다. 어떤 임계값도 안전하지 않다.
--       그래서 이 캐시는 정규화 문자열 완전일치만 본다 — 오탐 여지가 구조적으로 없다.
--
-- 안전망: 클라이언트 '재검색'(skipCache=true)은 메모를 건너뛰고 웹서치한 뒤 덮어쓴다.
--         나쁜 결과가 고착되지 않는다.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.content_search_memo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 키 원본. 정규화는 DB가 한다(엣지 함수가 정규화 로직을 복제하면 works 와 어긋난다).
  query_raw TEXT NOT NULL,
  category work_category NOT NULL,
  language TEXT NOT NULL DEFAULT 'ko',
  creator_raw TEXT,
  -- btrim: normalize_title 은 공백을 접기만 하고 앞뒤를 자르지 않는다. 여기 키는 유저가
  -- 직접 친 문자열이라 앞뒤 공백이 흔하고, 안 자르면 같은 제목이 캐시 미스가 된다.
  query_normalized TEXT GENERATED ALWAYS AS (public.normalize_title(btrim(query_raw))) STORED,
  creator_normalized TEXT GENERATED ALWAYS AS (public.normalize_title(btrim(COALESCE(creator_raw, '')))) STORED,
  -- verify-content 가 최종 반환한 candidates 배열 그대로
  candidates JSONB NOT NULL,
  is_empty BOOLEAN NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_hit_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);

-- 조회 키. language 를 포함하는 이유 — metadata 서술 언어가 사용자 설정을 따른다.
CREATE UNIQUE INDEX IF NOT EXISTS content_search_memo_key
  ON public.content_search_memo (query_normalized, category, language, creator_normalized);

CREATE INDEX IF NOT EXISTS content_search_memo_expires
  ON public.content_search_memo (expires_at);

-- 전역 공유 캐시이고 유저 데이터가 아니다(user_id 를 담지 않는다).
-- 클라이언트는 접근할 필요가 없으므로 정책을 두지 않는다 — service_role 만 RLS 를 우회한다.
ALTER TABLE public.content_search_memo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.content_search_memo FROM anon, authenticated;

-- ── 조회 ──
-- 정규화 문자열 완전일치 + 미만료. 히트하면 히트 카운트를 올리고 candidates 를 돌려준다.
CREATE OR REPLACE FUNCTION public.search_memo_get(
  p_query text,
  p_category work_category,
  p_language text DEFAULT 'ko',
  p_creator text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidates jsonb;
BEGIN
  -- 비정상 길이 키는 캐시 대상이 아니다(남용 방어). 에러가 아니라 미스로 처리.
  IF p_query IS NULL OR length(p_query) > 200 THEN
    RETURN NULL;
  END IF;

  UPDATE public.content_search_memo m
     SET hit_count = m.hit_count + 1,
         last_hit_at = NOW()
   WHERE m.query_normalized = public.normalize_title(btrim(p_query))
     AND m.category = p_category
     AND m.language = COALESCE(NULLIF(p_language, ''), 'ko')
     AND m.creator_normalized = public.normalize_title(btrim(COALESCE(p_creator, '')))
     AND m.expires_at > NOW()
  RETURNING m.candidates INTO v_candidates;

  RETURN v_candidates;
END;
$$;

-- ── 적재 ──
-- 웹서치가 끝난 뒤에만 호출된다. 같은 키가 있으면 덮어쓴다('재검색' 갱신 경로).
CREATE OR REPLACE FUNCTION public.search_memo_put(
  p_query text,
  p_category work_category,
  p_candidates jsonb,
  p_language text DEFAULT 'ko',
  p_creator text DEFAULT NULL,
  p_ttl_days integer DEFAULT 90
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lang    text := COALESCE(NULLIF(p_language, ''), 'ko');
  v_creator text := NULLIF(p_creator, '');
  v_expires timestamptz := NOW() + make_interval(days => GREATEST(1, COALESCE(p_ttl_days, 90)));
  v_empty   boolean;
BEGIN
  IF p_query IS NULL OR length(p_query) > 200 THEN
    RETURN;
  END IF;
  IF p_candidates IS NULL OR jsonb_typeof(p_candidates) <> 'array' THEN
    RETURN;
  END IF;
  v_empty := jsonb_array_length(p_candidates) = 0;

  -- 만료행 청소. put 은 웹서치(비용이 압도적인 경로) 직후에만 불리므로
  -- 여기 붙는 비용은 무시할 수준이고, 별도 cron 없이 테이블이 스스로 줄어든다.
  DELETE FROM public.content_search_memo WHERE expires_at < NOW();

  UPDATE public.content_search_memo m
     SET candidates = p_candidates,
         is_empty = v_empty,
         expires_at = v_expires,
         created_at = NOW(),
         hit_count = 0,
         last_hit_at = NULL
   WHERE m.query_normalized = public.normalize_title(btrim(p_query))
     AND m.category = p_category
     AND m.language = v_lang
     AND m.creator_normalized = public.normalize_title(btrim(COALESCE(v_creator, '')));

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.content_search_memo
        (query_raw, category, language, creator_raw, candidates, is_empty, expires_at)
      VALUES
        (p_query, p_category, v_lang, v_creator, p_candidates, v_empty, v_expires);
    EXCEPTION WHEN unique_violation THEN
      -- 동일 질의 동시 처리 — 먼저 넣은 쪽 위에 덮어쓴다.
      UPDATE public.content_search_memo m
         SET candidates = p_candidates,
             is_empty = v_empty,
             expires_at = v_expires
       WHERE m.query_normalized = public.normalize_title(btrim(p_query))
         AND m.category = p_category
         AND m.language = v_lang
         AND m.creator_normalized = public.normalize_title(btrim(COALESCE(v_creator, '')));
    END;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.search_memo_get(text, work_category, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_memo_put(text, work_category, jsonb, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_memo_get(text, work_category, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_memo_put(text, work_category, jsonb, text, text, integer) TO service_role;

COMMIT;
