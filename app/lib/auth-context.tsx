import { createContext, useContext, type ReactNode } from "react";
import { authClient } from "./auth-client";
import { signIn as authSignIn, signOut as authSignOut, type AuthUser } from "./auth";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  refresh(): Promise<void>;
  signIn(email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isPending, refetch } = authClient.useSession();
  const user = (data?.user as AuthUser | undefined) ?? null;

  const value: AuthState = {
    user,
    loading: isPending,
    async refresh() {
      await refetch();
    },
    async signIn(email, password) {
      const next = await authSignIn(email, password);
      await refetch();
      return next;
    },
    async signOut() {
      await authSignOut();
      await refetch();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
