import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHarness, type Harness } from "./helpers/harness.ts";
import type { App } from "../src/lib/app.ts";

let h: Harness | undefined;

function post(app: App, path: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  );
}

function payload(email: string, storeName: string) {
  return {
    email,
    password: "supersecret123",
    name: "Owner",
    storeName,
  };
}

beforeAll(async () => {
  h = await createHarness();
}, 120_000);

afterAll(async () => {
  await h?.dispose();
});

describe("setup failure and concurrency", () => {
  test("compensates for admin creation failure and allows retry", async () => {
    const app = await h!.app();
    const email = "existing-customer@andeshq.dev";

    const signUp = await post(app, "/api/auth/sign-up/email", {
      email,
      password: "supersecret123",
      name: "Existing customer",
    });
    expect(signUp.status).toBe(200);

    const failedSetup = await post(app, "/api/setup", payload(email, "Must not remain"));
    expect(failedSetup.status).toBe(409);

    const status = await app.fetch(new Request("http://localhost/api/setup/status"));
    expect(await status.json()).toEqual({ needsSetup: true });

    const settings = await app.fetch(
      new Request("http://localhost/api/rest/store_settings?select=name"),
    );
    expect(settings.status).toBe(200);
    expect(await settings.json()).toEqual([]);

    const retry = await post(
      app,
      "/api/setup",
      payload("first-admin@andeshq.dev", "Retry succeeded"),
    );
    expect(retry.status).toBe(201);
    const retryBody = (await retry.json()) as { store: { name: string } };
    expect(retryBody.store.name).toBe("Retry succeeded");
  });

  test("allows exactly one of two concurrent bootstrap requests", async () => {
    const app = await h!.app();
    const requests = [
      payload("race-one@andeshq.dev", "Race one"),
      payload("race-two@andeshq.dev", "Race two"),
    ];

    const responses = await Promise.all(requests.map((body) => post(app, "/api/setup", body)));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);

    const winnerIndex = responses.findIndex((response) => response.status === 201);
    const loserIndex = 1 - winnerIndex;
    const result = (await responses[winnerIndex]!.json()) as {
      user: { email: string };
      store: { name: string };
    };
    expect(result.user.email).toBe(requests[winnerIndex]!.email);
    expect(result.store.name).toBe(requests[winnerIndex]!.storeName);

    const loserLogin = await post(app, "/api/auth/sign-in/email", {
      email: requests[loserIndex]!.email,
      password: requests[loserIndex]!.password,
    });
    expect(loserLogin.status).toBeGreaterThanOrEqual(400);

    const status = await app.fetch(new Request("http://localhost/api/setup/status"));
    expect(await status.json()).toEqual({ needsSetup: false });
  });
});
