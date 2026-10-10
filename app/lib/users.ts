import { authClient } from "./auth-client";

/** Roles that can sign in to the admin (customers are storefront-only). */
export const TEAM_ROLES = ["admin", "staff"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export interface TeamUser {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  banned?: boolean | null;
  banReason?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** Wraps a Better Auth client error so callers get a stable shape. */
export class TeamError extends Error {
  readonly code?: string;

  constructor(error: { message?: string; code?: string } | null | undefined) {
    super(error?.message ?? "The request failed.");
    this.name = "TeamError";
    this.code = error?.code;
  }
}

type AdminResult = { error: { message?: string; code?: string } | null };

function throwIfError(result: AdminResult): void {
  if (result.error) throw new TeamError(result.error);
}

/** Team members only (admins and staff); customers never appear here. */
export async function listTeamUsers(): Promise<TeamUser[]> {
  // Two scalar filters rather than an array: query-string array parsing is
  // fiddly, and team membership is just "admin" or "staff".
  const [admins, staff] = await Promise.all(
    TEAM_ROLES.map((role) =>
      authClient.admin.listUsers({
        query: {
          filterField: "role",
          filterValue: role,
          sortBy: "createdAt",
          sortDirection: "desc",
          limit: 200,
        },
      }),
    ),
  );
  if (admins.error) throw new TeamError(admins.error);
  if (staff.error) throw new TeamError(staff.error);

  const members = [
    ...((admins.data?.users ?? []) as unknown as TeamUser[]),
    ...((staff.data?.users ?? []) as unknown as TeamUser[]),
  ];
  return members.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export async function getTeamUser(id: string): Promise<TeamUser | null> {
  const { data, error } = await authClient.admin.listUsers({
    query: { filterField: "id", filterValue: id, limit: 1 },
  });
  if (error) throw new TeamError(error);
  return (data?.users?.[0] as unknown as TeamUser | undefined) ?? null;
}

export async function createTeamUser(input: {
  name: string;
  email: string;
  password: string;
  role: TeamRole;
}): Promise<TeamUser> {
  // The plugin types roles as its default union ("admin" | "user"); this app
  // stores opaque role strings ("admin" | "staff" | "customer") at runtime.
  const { data, error } = await authClient.admin.createUser(
    input as Parameters<typeof authClient.admin.createUser>[0],
  );
  if (error) throw new TeamError(error);
  return data.user as unknown as TeamUser;
}

export async function updateTeamProfile(
  id: string,
  data: { name: string; email: string },
): Promise<void> {
  throwIfError(await authClient.admin.updateUser({ userId: id, data }));
}

export async function setTeamRole(id: string, role: TeamRole): Promise<void> {
  throwIfError(
    await authClient.admin.setRole({
      userId: id,
      role,
    } as Parameters<typeof authClient.admin.setRole>[0]),
  );
}

export async function banTeamUser(id: string, reason?: string): Promise<void> {
  throwIfError(await authClient.admin.banUser({ userId: id, banReason: reason }));
}

export async function unbanTeamUser(id: string): Promise<void> {
  throwIfError(await authClient.admin.unbanUser({ userId: id }));
}

export async function removeTeamUser(id: string): Promise<void> {
  throwIfError(await authClient.admin.removeUser({ userId: id }));
}

export async function setTeamPassword(id: string, newPassword: string): Promise<void> {
  throwIfError(await authClient.admin.setUserPassword({ userId: id, newPassword }));
}

const ERROR_MESSAGES: Record<string, string> = {
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "That email is already in use.",
  USER_ALREADY_EXISTS: "That email is already in use.",
  YOU_CANNOT_BAN_YOURSELF: "You cannot suspend your own account.",
  YOU_CANNOT_REMOVE_YOURSELF: "You cannot remove your own account.",
  YOU_ARE_NOT_ALLOWED_TO_SET_NON_EXISTENT_VALUE: "That role is not allowed.",
};

/** Turn a thrown TeamError into user-facing messages. */
export function teamErrorMessages(error: unknown): string[] {
  if (!(error instanceof TeamError)) {
    return ["Something went wrong. Please try again."];
  }
  if (error.code && ERROR_MESSAGES[error.code]) {
    return [ERROR_MESSAGES[error.code]];
  }
  if (/last admin/i.test(error.message)) {
    return ["You must keep at least one admin."];
  }
  return [error.message];
}
