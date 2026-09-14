-- ============================================================
-- 별칭 승격 (ISSUE-016 C)
--
-- 왜: 질의 메모 캐시(content_search_memo)는 TTL 이 있고, "같은 문자열을 다시 친 경우"만
--     공짜로 만든다. 오타를 정답 작품에 **영구히** 연결하지는 않는다.
--     사용자가 'Feel so good' 을 치고 'Feels So Good' 을 확정했다면, 그 사실 자체가
--     "이 문자열은 이 작품을 가리킨다"는 사람이 검증한 정보다. 그걸 버리지 않는다.
--
-- 무엇: 작품 확정 시 사용자가 실제로 친 문자열을 그 작품의 별칭으로 남긴다.
--       다음부터는 처음 치는 사람도 캐시에 바로 걸린다(웹서치 0회).
--
-- 왜 works.original_title 이 아닌 별도 테이블인가: original_title 은 recommend-content 가
--       추천 검증에 쓰는 필드다. 오타를 그 자리에 넣으면 추천 검증이 오염된다.
--
-- 매칭은 정규화 완전일치만 본다 — 유사도를 쓰면 속편/오타 구분 문제가 그대로 따라온다.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.work_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  -- 사용자가 실제로 친 문자열
  alias_raw TEXT NOT NULL,
  category work_category NOT NULL,
  -- btrim: normalize_title 은 앞뒤 공백을 자르지 않는다. 키가 사용자 입력이라 필수다.
  alias_normalized TEXT GENERATED ALWAYS AS (public.normalize_title(btrim(alias_raw))) STORED,
  -- 이 별칭으로 캐시 히트한 횟수 — 쓸모없는 별칭을 나중에 걷어내기 위한 근거
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_hit_at TIMESTAMPTZ
);

-- 같은 (별칭, 카테고리)는 하나의 작품만 가리킨다. 먼저 등록된 쪽이 이긴다.
CREATE UNIQUE INDEX IF NOT EXISTS work_aliases_key
  ON public.work_aliases (alias_normalized, category);
CREATE INDEX IF NOT EXISTS work_aliases_work_id ON public.work_aliases (work_id);

-- 전역 공유 데이터이고 유저 소유가 아니다. 클라이언트는 접근할 필요가 없다.
ALTER TABLE public.work_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.work_aliases FROM anon, authenticated;

-- ── 조회 ──
-- 별칭이 가리키는 작품을 돌려준다. 신뢰 행(is_verified 또는 외부 ingestion)만 인정한다 —
-- 별칭이 붙은 뒤 작품 행이 강등되는 경로는 없지만, 캐시 판정 기준을 한곳으로 맞춘다.
CREATE OR REPLACE FUNCTION public.lookup_work_alias(
  p_query text,
  p_category work_category
)
RETURNS TABLE (
  id uuid, title text, original_title text, creator text,
  year integer, genre text, metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_query IS NULL OR length(p_query) > 200 THEN
    RETURN;
  END IF;

  UPDATE public.work_aliases a
     SET hit_count = a.hit_count + 1, last_hit_at = NOW()
   WHERE a.alias_normalized = public.normalize_title(btrim(p_query))
     AND a.category = p_category
     AND EXISTS (
       SELECT 1 FROM public.works w
       WHERE w.id = a.work_id AND (w.is_verified OR w.primary_source IS NOT NULL)
     );

  RETURN QUERY
  SELECT w.id, w.title, w.original_title, w.creator, w.year, w.genre, w.metadata
  FROM public.work_aliases a
  JOIN public.works w ON w.id = a.work_id
  WHERE a.alias_normalized = public.normalize_title(btrim(p_query))
    AND a.category = p_category
    AND (w.is_verified OR w.primary_source IS NOT NULL)
  LIMIT 1;
END;
$$;

-- ── 등록 ──
-- 작품 확정 시 호출. 사용자가 친 문자열이 확정된 작품 제목과 사실상 같으면 남기지 않는다
-- (제목 그대로 친 경우까지 별칭으로 쌓을 이유가 없다 — works 조회가 이미 잡는다).
CREATE OR REPLACE FUNCTION public.record_work_alias(
  p_work_id uuid,
  p_query text,
  p_category work_category
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text;
  v_title_norm text;
  v_original_norm text;
BEGIN
  IF p_work_id IS NULL OR p_query IS NULL OR length(p_query) > 200 THEN
    RETURN;
  END IF;
  v_norm := public.normalize_title(btrim(p_query));
  IF v_norm IS NULL OR v_norm = '' THEN
    RETURN;
  END IF;

  SELECT w.title_normalized, w.original_title_normalized
    INTO v_title_norm, v_original_norm
  FROM public.works w WHERE w.id = p_work_id;

  -- 작품을 못 찾거나, 제목·원제와 같은 문자열이면 별칭이 아니다.
  IF v_title_norm IS NULL THEN RETURN; END IF;
  IF v_norm = v_title_norm OR v_norm = COALESCE(v_original_norm, '') THEN RETURN; END IF;

  INSERT INTO public.work_aliases (work_id, alias_raw, category)
  VALUES (p_work_id, btrim(p_query), p_category)
  ON CONFLICT (alias_normalized, category) DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lookup_work_alias(text, work_category) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_work_alias(uuid, text, work_category) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_work_alias(text, work_category) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_work_alias(uuid, text, work_category) TO service_role;

COMMIT;
