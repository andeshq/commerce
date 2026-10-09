import { describe, expect, test } from "bun:test";
import { mapAppRoleToPgRole } from "../src/lib/pgbase.ts";

/**
 * Role mapping is the escalation guard: an unknown role must resolve to the
 * anon Postgres role, never to the connection role.
 */
describe("mapAppRoleToPgRole", () => {
  test("maps known app roles", () => {
    expect(mapAppRoleToPgRole("admin", "web_anon")).toBe("web_admin");
    expect(mapAppRoleToPgRole("staff", "web_anon")).toBe("web_staff");
    expect(mapAppRoleToPgRole("customer", "web_anon")).toBe("web_customer");
  });

  test("falls back to anon for unknown roles", () => {
    expect(mapAppRoleToPgRole("superuser", "web_anon")).toBe("web_anon");
    expect(mapAppRoleToPgRole("web_admin", "web_anon")).toBe("web_anon");
  });

  test("falls back to anon for absent roles", () => {
    expect(mapAppRoleToPgRole(undefined, "web_anon")).toBe("web_anon");
    expect(mapAppRoleToPgRole(null, "web_anon")).toBe("web_anon");
    expect(mapAppRoleToPgRole("", "web_anon")).toBe("web_anon");
  });
});
