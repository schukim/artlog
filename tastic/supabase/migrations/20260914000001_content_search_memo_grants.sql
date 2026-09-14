-- ============================================================
-- 질의 메모 캐시 — 실행 권한 정정
--
-- 왜: 20260914000000 에서 REVOKE ALL ... FROM PUBLIC 만 걸었는데, Supabase 는
--     public 스키마의 신규 함수에 anon/authenticated 로 EXECUTE 를 자동 부여한다
--     (ALTER DEFAULT PRIVILEGES). PUBLIC 회수는 롤별 개별 부여분을 지우지 못하므로
--     적용 직후 확인 결과 anon·authenticated 모두 실행 가능 상태였다.
--
-- 왜 위험한가: search_memo_put 은 SECURITY DEFINER 쓰기 함수다. 임의 사용자가
--     임의 질의 키에 임의 candidates JSON 을 심을 수 있으면, 그 위조 메타데이터가
--     전역 캐시를 타고 다른 모든 사용자의 작품 확인 화면에 그대로 노출된다.
--     읽기(get)도 히트 카운트를 올리는 쓰기 경로라 함께 막는다.
--
-- 이 함수들은 엣지 함수(verify-content)가 service_role 로만 호출한다.
-- ============================================================

BEGIN;

REVOKE EXECUTE ON FUNCTION public.search_memo_get(text, work_category, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.search_memo_put(text, work_category, jsonb, text, text, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.search_memo_get(text, work_category, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_memo_put(text, work_category, jsonb, text, text, integer) TO service_role;

COMMIT;
