import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import type { User } from "../types/database";

// 프로필(users row) 로드 상태. user=null 만으로는 "아직 로딩 중"인지 "조회 실패"인지
// 구분할 수 없어서 별도로 추적한다. 세션은 있는데 프로필 조회가 실패한 경우를
// Main 으로 흘려보내지 않고 재시도 화면으로 분기하기 위함이다.
export type ProfileStatus = "loading" | "loaded" | "error";

interface AuthState {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  profileStatus: ProfileStatus;
  // 비밀번호 재설정 링크로 들어왔음을 표시한다. 켜져 있는 동안에는 세션이 있어도
  // Main 으로 보내지 않고 새 비밀번호 화면에 머문다(resolveAuthRoute).
  passwordRecovery: boolean;
  setSession: (session: Session | null) => void;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  setProfileStatus: (status: ProfileStatus) => void;
  setPasswordRecovery: (active: boolean) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  isLoading: true,
  profileStatus: "loading",
  passwordRecovery: false,
  setSession: (session) => set({ session }),
  setUser: (user) => set({ user }),
  setLoading: (isLoading) => set({ isLoading }),
  setProfileStatus: (profileStatus) => set({ profileStatus }),
  setPasswordRecovery: (passwordRecovery) => set({ passwordRecovery }),
  reset: () =>
    set({
      session: null,
      user: null,
      isLoading: false,
      profileStatus: "loading",
      passwordRecovery: false,
    }),
}));
