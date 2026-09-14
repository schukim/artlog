import type { Work, ContentCategory } from "../types/database";
import type { Json } from "../types/supabase";
import { supabase } from "./supabase";

interface CreateWorkParams {
  userId: string;
  title: string;
  category: ContentCategory;
  originalTitle?: string;
  creator?: string;
  year?: number;
  genre?: string;
  metadata?: Record<string, unknown>;
}

export async function createWork(params: CreateWorkParams): Promise<Work> {
  const { data, error } = await supabase
    .from("works")
    .insert({
      user_id: params.userId,
      title: params.title,
      original_title: params.originalTitle ?? null,
      category: params.category,
      creator: params.creator ?? null,
      year: params.year ?? null,
      genre: params.genre ?? null,
      metadata: (params.metadata ?? {}) as Json,
    })
    .select()
    .single();

  if (error) {
    console.error("createWork error:", error);
    throw new Error(`작품 정보 저장에 실패했습니다 (${error.code}): ${error.message}`);
  }

  // DB row(category enum superset·nullable 등)를 도메인 Work 로 신뢰 변환
  return data as unknown as Work;
}

export async function fetchWorksByUser(userId: string): Promise<Work[]> {
  const { data, error } = await supabase
    .from("works")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("fetchWorksByUser error:", error);
    throw new Error(`작품 목록 조회에 실패했습니다: ${error.message}`);
  }

  return (data ?? []) as unknown as Work[];
}

// 작품 확정(후보 선택) 시: verify-content로 식별된 작품을 is_verified=true로 저장/승격해
// 전역 캐시로 공유한다. is_verified는 클라가 직접 못 세우므로 service-role 엣지 함수에 위임.
// (수동 입력 경로는 이 함수 대신 createWork(is_verified=false)를 그대로 사용)
// 사용자 식별은 서버가 Authorization 토큰에서 수행 — userId 를 보내지 않는다.
export async function saveVerifiedWork(
  contentInfo: {
    title: string;
    category: ContentCategory;
    originalTitle?: string;
    creator?: string;
    year?: number;
    genre?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<Work> {
  const { data, error } = await supabase.functions.invoke("save-verified-work", {
    body: {
      title: contentInfo.title,
      category: contentInfo.category,
      originalTitle: contentInfo.originalTitle ?? null,
      creator: contentInfo.creator ?? null,
      year: contentInfo.year ?? null,
      genre: contentInfo.genre ?? null,
      metadata: contentInfo.metadata ?? {},
    },
  });

  if (error) {
    console.error("saveVerifiedWork error:", error);
    throw new Error("작품 정보 저장에 실패했습니다.");
  }
  if (!data?.work) throw new Error("작품 정보 저장에 실패했습니다.");
  return data.work as Work;
}

// 제목 완전일치(정규화 후) 행만 재사용한다. 유사도 근접 매칭은 쓰지 않는다 —
// 실측상 오타↔정답이 0.80, 1편↔속편이 0.87 이라 "붙여야 할 쌍"보다 "떼야 할 쌍"의
// 점수가 높다. 어떤 임계값을 잡아도 둘 중 하나는 틀리므로, 여기선 확실한 중복
// (같은 제목·같은 카테고리)만 합치고 나머지는 새 행으로 둔다.
const EXACT_TITLE_MATCH = 0.999;

// 동일 작품이 카탈로그에 있으면 재사용, 없으면 새로 생성.
// search_works RPC로 외부 ingestion 작품도 매칭한다.
export async function findOrCreateWork(
  userId: string,
  contentInfo: {
    title: string;
    category: ContentCategory;
    originalTitle?: string;
    creator?: string;
    year?: number;
    genre?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<Work> {
  // 임베딩을 넘기지 않으므로 제목 trigram 유사도만으로 0~1 스케일이 되도록 가중치를 조정한다.
  // (기본값 trigram 0.4 / embedding 0.6 이면 점수 상한이 0.40 이라 재사용 판정이 한 번도
  //  성립하지 않았고, 수동입력마다 중복 행이 쌓였다 — 실측 'Speed Drive' 4행)
  const { data: matches, error: searchError } = await supabase.rpc("search_works", {
    query_text: contentInfo.title,
    target_category: contentInfo.category,
    trigram_weight: 1.0,
    embedding_weight: 0.0,
    limit_count: 5,
  });

  if (searchError) {
    console.error("findOrCreateWork search error:", searchError);
  }

  // similarity_score 는 창작자 보너스(+0.15)가 섞여 1.00 이 되어도 제목이 같다는 보장이 없다.
  // 제목 일치 여부는 trigram_score 로만 판단하고, 동점이면 신뢰 행을 우선한다.
  const exact = (matches ?? []).filter((m) => (m.trigram_score ?? 0) >= EXACT_TITLE_MATCH);
  const best = exact.find((m) => m.is_verified || m.primary_source != null) ?? exact[0];
  if (best) {
    const { data, error } = await supabase
      .from("works")
      .select("*")
      .eq("id", best.id)
      .single();
    if (!error && data) return data as unknown as Work;
  }

  return createWork({
    userId,
    title: contentInfo.title,
    originalTitle: contentInfo.originalTitle,
    category: contentInfo.category,
    creator: contentInfo.creator,
    year: contentInfo.year,
    genre: contentInfo.genre,
    metadata: contentInfo.metadata,
  });
}
