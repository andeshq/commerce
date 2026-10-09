import { authClient } from "./auth-client";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role?: string | null;
}

export class AuthError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Auth request failed with status ${status}`);
    this.name = "AuthError";
    this.status = status;
    this.body = body;
  }
}

export async function getSession(): Promise<AuthUser | null> {
  const { data } = await authClient.getSession();
  return (data?.user as AuthUser | undefined) ?? null;
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const { error } = await authClient.signIn.email({ email, password });
  if (error) throw new AuthError(error.status, error);

  const user = await getSession();
  if (!user) throw new AuthError(401, null);
  return user;
}

export async function signOut(): Promise<void> {
  await authClient.signOut();
}

export function isStaff(user: AuthUser | null | undefined): boolean {
  return user?.role === "admin" || user?.role === "staff";
}

export function authErrorMessages(error: unknown): string[] {
  if (!(error instanceof AuthError)) {
    return ["Something went wrong. Please try again."];
  }
  if (error.status === 401 || error.status === 403) {
    return ["Invalid email or password."];
  }
  const body = error.body as { message?: string } | null;
  return [body?.message ?? `Sign-in failed (${error.status}).`];
}
