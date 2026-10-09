export interface SetupStatus {
  needsSetup: boolean;
}

export interface SetupInput {
  email: string;
  password: string;
  name: string;
  storeName: string;
  currencyCode?: string;
  locale?: string;
  pricesIncludeTax?: boolean;
}

export interface SetupResult {
  user: { id: string; email: string; name: string };
  store: {
    name: string;
    currencyCode: string;
    locale: string;
    pricesIncludeTax: boolean;
  };
}

export interface ValidationIssue {
  path: (string | number)[];
  message: string;
}

/** Non-2xx response from the API, carrying the parsed error body. */
export class SetupError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Setup request failed with status ${status}`);
    this.name = "SetupError";
    this.status = status;
    this.body = body;
  }
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const response = await fetch("/api/setup/status", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new SetupError(response.status, null);
  }
  return (await response.json()) as SetupStatus;
}

export async function runSetup(input: SetupInput): Promise<SetupResult> {
  const response = await fetch("/api/setup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(input),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new SetupError(response.status, body);
  }
  return body as SetupResult;
}

/** Turn an unknown thrown value into user-facing messages. */
export function setupErrorMessages(error: unknown): string[] {
  if (!(error instanceof SetupError)) {
    return ["Something went wrong. Please try again."];
  }
  if (error.status === 409) {
    return ["This instance has already been set up."];
  }

  const body = error.body as
    | { error?: string; issues?: ValidationIssue[]; message?: string }
    | null;

  if (body?.error === "validation_error" && body.issues?.length) {
    return body.issues.map(
      (issue) => `${issue.path.join(".") || "field"}: ${issue.message}`,
    );
  }
  if (body?.message) return [body.message];
  return [`Request failed (${error.status}).`];
}
