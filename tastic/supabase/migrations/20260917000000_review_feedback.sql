-- ============================================================
-- 평론 만족도 피드백 + 재생성 카운트 계측
-- 목적: 지금까지 만족도는 전부 대리지표였다. 사용자가 직접 남긴 신호를 기록한다.
-- ============================================================

-- ── review_feedback ──
-- 1인 1평론 1건 (unique + upsert). 마음이 바뀌면 행을 새로 쌓지 않고 덮어쓴다.
create table public.review_feedback (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  rating text not null check (rating in ('up','down')),
  reason text check (reason in ('not_mine','questions','facts','tone','thin','other')),
  comment text check (char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_id, user_id),
  -- up 은 만족 신호 자체가 전부다 — reason/comment 는 down 에만 의미가 있다.
  check ((rating = 'up' and reason is null and comment is null) or rating = 'down')
);
comment on table public.review_feedback is
  '평론 만족도 피드백 (1인 1평론 1건, 수정 가능). reason 코드는 L1 루브릭 A~E와 대응';

create index idx_review_feedback_review_id on public.review_feedback (review_id);

alter table public.review_feedback enable row level security;

create policy "Users can view own review feedback"
  on public.review_feedback for select
  using (auth.uid() = user_id);

-- insert: 본인 것으로만 남기는 것으로는 부족하다 — review_id 가 실제로 본인 소유
-- 평론인지도 같이 검증한다. (reviews 자체 RLS로도 결과적으론 막히지만, 이 테이블의
-- 정책만 보고도 침해 범위를 판단할 수 있도록 명시적으로 둔다.)
create policy "Users can insert own review feedback"
  on public.review_feedback for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.reviews r
      where r.id = review_id and r.user_id = auth.uid()
    )
  );

-- update: 👍↔👎 번복을 위한 덮어쓰기. delete 정책은 두지 않는다 — 피드백은 철회가 아니라 갱신 대상.
create policy "Users can update own review feedback"
  on public.review_feedback for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.reviews r
      where r.id = review_id and r.user_id = auth.uid()
    )
  );

create trigger set_review_feedback_updated_at
  before update on public.review_feedback
  for each row execute function public.handle_updated_at();

-- ── 재생성 카운트 ──
alter table public.interviews
  add column review_generate_count integer not null default 0;
comment on column public.interviews.review_generate_count is
  '최종 평론 생성 호출 횟수. 2 이상 = 사용자가 재생성함 (미리보기는 세지 않음)';

-- Edge Function(service_role)에서 원자적으로 증가시키기 위한 RPC.
-- 클라이언트가 읽고 쓰면(select 후 update) 그 사이 레이스가 생긴다 — 단일 update 문으로 처리.
create or replace function public.increment_review_generate_count(p_interview_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.interviews
    set review_generate_count = review_generate_count + 1
    where id = p_interview_id;
end;
$$;

revoke all on function public.increment_review_generate_count(uuid) from public;
revoke all on function public.increment_review_generate_count(uuid) from anon, authenticated;
grant execute on function public.increment_review_generate_count(uuid) to service_role;
