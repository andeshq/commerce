import { describe, expect, test } from "bun:test";
import {
  defaultLocationName,
  defaultTax,
  setupSchema,
} from "../src/service/setup.service.ts";

describe("setup schema", () => {
  test("applies LATAM defaults", () => {
    const parsed = setupSchema.parse({
      email: "owner@andeshq.dev",
      password: "supersecret123",
      name: "Owner",
      storeName: "Andes",
    });

    expect(parsed.currencyCode).toBe("COP");
    expect(parsed.locale).toBe("es-CO");
    expect(parsed.pricesIncludeTax).toBe(true);
  });

  test("names the first location in the chosen language", () => {
    expect(defaultLocationName("es-CO")).toBe("Tienda principal");
    expect(defaultLocationName("en-US")).toBe("Main location");
  });

  test("defaults tax to IVA for Colombia, none otherwise", () => {
    expect(defaultTax("es-CO")).toEqual({ rateBps: 1900, label: "IVA" });
    expect(defaultTax("en-US")).toEqual({ rateBps: 0, label: "Tax" });
  });

  test("rejects a short password", () => {
    const result = setupSchema.safeParse({
      email: "owner@andeshq.dev",
      password: "short",
      name: "Owner",
      storeName: "Andes",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an invalid email", () => {
    const result = setupSchema.safeParse({
      email: "nope",
      password: "supersecret123",
      name: "Owner",
      storeName: "Andes",
    });
    expect(result.success).toBe(false);
  });
});
