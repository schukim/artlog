import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Content, ConversationEntry } from "../types/database";

const DRAFT_KEY = "tastic_interview_draft";
const UNSAVED_REVIEWS_KEY = "tastic_unsaved_reviews";
const INTRO_SEEN_KEY = "tastic_intro_seen";
const DRAFT_EXPIRY_DAYS = 7;

// ── Intro Tour (기능 가이드) ──
// 노출 여부를 기기 로컬에 저장한다 — 계정이 아니라 "이 기기에서 앱을 처음 실행했는지"
// 로 판단해, 로그인 전에 1회만 보여준다. 다른 계정으로 로그인해도 다시 뜨지 않는다.

export async function getIntroSeen(): Promise<boolean> {
  return (await AsyncStorage.getItem(INTRO_SEEN_KEY)) === "true";
}

export async function markIntroSeen(): Promise<void> {
  await AsyncStorage.setItem(INTRO_SEEN_KEY, "true");
}

// 드래프트/미저장 평론은 userId 로 스코프한다 — 같은 기기에서 계정을 전환했을 때
// 다른 계정의 인터뷰 내용이 노출되거나(프라이버시), 다른 계정 명의로
// 업로드되는(syncUnsavedReviews) 것을 막기 위함.

export interface StoredDraft {
  userId: string;
  content: Content;
  conversation: ConversationEntry[];
  questionCount: number;
  interviewId: string | null;
  savedAt: string;
}

export interface UnsavedReview {
  userId: string;
  contentId: string;
  title: string | null;
  body: string;
  experienceDate: string | null;
  interviewId: string;
  savedAt: string;
}

// ── Interview Draft ──

export async function saveDraft(draft: StoredDraft): Promise<void> {
  await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export async function loadDraft(userId: string): Promise<StoredDraft | null> {
  const raw = await AsyncStorage.getItem(DRAFT_KEY);
  if (!raw) return null;

  const draft: StoredDraft = JSON.parse(raw);

  // 다른 계정(또는 userId 없는 구버전)의 드래프트는 노출하지 않는다
  if (draft.userId !== userId) return null;

  const savedAt = new Date(draft.savedAt);
  const now = new Date();
  const diffDays = (now.getTime() - savedAt.getTime()) / (1000 * 60 * 60 * 24);

  if (diffDays > DRAFT_EXPIRY_DAYS) {
    await clearDraft();
    return null;
  }

  return draft;
}

export async function clearDraft(): Promise<void> {
  await AsyncStorage.removeItem(DRAFT_KEY);
}

// ── Unsaved Reviews ──

// 전체 목록(계정 무관) — 저장/삭제 시 다른 계정 항목을 보존하기 위한 내부용
async function getAllUnsavedReviews(): Promise<UnsavedReview[]> {
  const raw = await AsyncStorage.getItem(UNSAVED_REVIEWS_KEY);
  return raw ? JSON.parse(raw) : [];
}

// 같은 (계정·작품·인터뷰) 조합은 한 건만 유지한다.
// 평론 한 편은 생성 직후·편집 후 이탈·저장 실패 시점에 각각 보관되므로,
// 단순 push 로는 같은 평론이 여러 벌 쌓여 syncUnsavedReviews 가 중복 업로드한다.
function isSameTarget(a: UnsavedReview, b: UnsavedReview): boolean {
  return (
    a.userId === b.userId &&
    a.contentId === b.contentId &&
    (a.interviewId ?? "") === (b.interviewId ?? "")
  );
}

export async function upsertUnsavedReview(review: UnsavedReview): Promise<void> {
  const existing = await getAllUnsavedReviews();
  const others = existing.filter((r) => !isSameTarget(r, review));
  others.push(review);
  await AsyncStorage.setItem(UNSAVED_REVIEWS_KEY, JSON.stringify(others));
}

// 서버 저장에 성공했을 때 로컬 보관분을 걷어낸다.
export async function removeUnsavedReviewFor(
  userId: string,
  contentId: string,
  interviewId: string | null,
): Promise<void> {
  const existing = await getAllUnsavedReviews();
  const others = existing.filter(
    (r) =>
      !(
        r.userId === userId &&
        r.contentId === contentId &&
        (r.interviewId ?? "") === (interviewId ?? "")
      ),
  );
  await AsyncStorage.setItem(UNSAVED_REVIEWS_KEY, JSON.stringify(others));
}

// 해당 계정의 미저장 평론만 반환 — 타 계정 명의 업로드 방지
export async function getUnsavedReviews(userId: string): Promise<UnsavedReview[]> {
  const all = await getAllUnsavedReviews();
  return all.filter((r) => r.userId === userId);
}

export async function clearUnsavedReviews(): Promise<void> {
  await AsyncStorage.removeItem(UNSAVED_REVIEWS_KEY);
}

// interviewId 는 비어있을 수 있어("") savedAt 을 키로 쓴다.
export async function removeUnsavedReview(savedAt: string): Promise<void> {
  const existing = await getAllUnsavedReviews();
  const filtered = existing.filter((r) => r.savedAt !== savedAt);
  await AsyncStorage.setItem(UNSAVED_REVIEWS_KEY, JSON.stringify(filtered));
}

// 계정 삭제 시 해당 계정의 로컬 데이터 전체 정리
export async function clearLocalDataForUser(userId: string): Promise<void> {
  const raw = await AsyncStorage.getItem(DRAFT_KEY);
  if (raw) {
    try {
      const draft: StoredDraft = JSON.parse(raw);
      if (draft.userId === userId) await clearDraft();
    } catch {
      await clearDraft();
    }
  }
  const all = await getAllUnsavedReviews();
  const others = all.filter((r) => r.userId !== userId);
  await AsyncStorage.setItem(UNSAVED_REVIEWS_KEY, JSON.stringify(others));
}
