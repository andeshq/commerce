import { singleton } from "tsyringe";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
import { join, normalize, sep } from "node:path";
import { ZodError } from "zod";
import { Config } from "../config/config.ts";
import { Auth } from "./auth.ts";
import { Pgbase } from "./pgbase.ts";
import { SetupService, setupSchema } from "../service/setup.service.ts";
import { MediaService } from "../service/media.service.ts";
import { PaymentService, type ProviderUpdate } from "../service/payment/payment.service.ts";

@singleton()
export class App {
  readonly hono: Hono;

  constructor(
    config: Config,
    auth: Auth,
    pgbase: Pgbase,
    setup: SetupService,
    media: MediaService,
    payments: PaymentService,
  ) {
    const app = new Hono();

    app.use("*", logger());
    app.use("*", secureHeaders());

    app.onError((err, c) => {
      if (err instanceof HTTPException) {
        // JSON body so the SPA can read `message`; Hono's default is plain text.
        if (err.res) return err.res;
        return c.json({ message: err.message }, err.status);
      }
      if (err instanceof ZodError) {
        return c.json({ error: "validation_error", issues: err.issues }, 400);
      }
      console.error(err);
      return c.json({ error: "internal_error" }, 500);
    });

    app.get("/health", (c) => c.json({ status: "ok" }));

    // Bootstrap. Open until the first admin exists, then 409 forever.
    app.get("/api/setup/status", async (c) =>
      c.json({ needsSetup: await setup.needsSetup() }),
    );
    app.post("/api/setup", async (c) => {
      const input = setupSchema.parse(await c.req.json());
      const result = await setup.run(input);
      return c.json(result, 201);
    });

    app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handle(c.req.raw));

    // Image bytes: uploads are staff-only, files are served publicly by UUID.
    app.post("/api/media", async (c) => {
      await auth.requireStaff(c.req.raw.headers);
      return c.json(await media.upload(c.req.raw), 201);
    });
    app.delete("/api/media/:id", async (c) => {
      await auth.requireStaff(c.req.raw.headers);
      await media.remove(c.req.param("id"));
      return c.body(null, 204);
    });
    app.get("/media/:file", async (c) => {
      const file = await media.file(c.req.param("file"));
      if (!file) return c.notFound();
      return new Response(file, {
        headers: { "cache-control": "public, max-age=31536000, immutable" },
      });
    });

    // Payments. Starting a payment is authorized by the order's access token
    // (guests have no session); webhooks are gateway-callable; provider config
    // is admin-only and never returns credentials.
    app.post("/api/checkout/:token/pay", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as {
        provider?: string;
        method?: string;
        return_url?: string;
      };
      return c.json(
        await payments.createIntent(c.req.param("token"), {
          provider: body.provider,
          method: body.method,
          returnUrl: c.req.query("returnUrl") ?? body.return_url,
        }),
      );
    });
    app.get("/api/payments/methods", async (c) => c.json(await payments.listMethods()));
    app.post("/api/payments/:provider/webhook", async (c) => {
      await payments.handleWebhook(c.req.param("provider"), c.req.raw);
      return c.json({ received: true });
    });
    app.get("/api/payments/providers", async (c) => {
      await auth.requireAdmin(c.req.raw.headers);
      return c.json(await payments.listProviders());
    });
    app.put("/api/payments/providers/:provider", async (c) => {
      await auth.requireAdmin(c.req.raw.headers);
      const body = (await c.req.json()) as ProviderUpdate;
      return c.json(await payments.updateProvider(c.req.param("provider"), body));
    });
    app.post("/api/orders/:id/refund", async (c) => {
      await auth.requireStaff(c.req.raw.headers);
      const body = (await c.req.json().catch(() => ({}))) as { amount_cents?: number };
      return c.json(await payments.refund(c.req.param("id"), body.amount_cents));
    });

    app.all(`${config.basePath}/*`, (c) => pgbase.handler(c.req.raw));

    // Production: serve the built admin UI from the same origin. Real files win;
    // anything else falls back to index.html so client-side routes resolve.
    if (config.serveStatic) {
      app.get("*", serveApp(config.staticDir));
    }

    this.hono = app;
  }

  readonly fetch = (request: Request): Response | Promise<Response> =>
    this.hono.fetch(request);
}

/**
 * Serve the built SPA. Hashed assets are cached forever; everything else is
 * `no-store`, and unknown paths return `index.html` for client-side routing.
 * Paths are normalized and confined to `root` to prevent traversal.
 */
function serveApp(root: string) {
  return async (c: Context) => {
    const pathname = decodeURIComponent(new URL(c.req.url).pathname);
    const relative = pathname.replace(/^\/+/, "");
    const target = normalize(join(root, relative));
    if (target !== root && !target.startsWith(root + sep)) return c.notFound();

    if (relative) {
      const file = Bun.file(target);
      if ((await file.exists()) && (await file.stat()).isFile()) {
        return new Response(file, {
          headers: {
            "cache-control": relative.startsWith("assets/")
              ? "public, max-age=31536000, immutable"
              : "no-store",
          },
        });
      }
    }

    const index = Bun.file(join(root, "index.html"));
    if (await index.exists()) {
      return new Response(index, { headers: { "cache-control": "no-store" } });
    }
    return c.notFound();
  };
}
