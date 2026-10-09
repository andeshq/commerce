import "reflect-metadata"; // MUST be first: tsyringe reads decorator metadata.

import { container } from "tsyringe";
import { Config } from "./config/config.ts";
import { Database } from "./database/database.ts";
import { App } from "./lib/app.ts";

// Import side-effect registers each @singleton(); resolve eagerly so
// misconfiguration fails at boot rather than on the first request.
import "./lib/auth.ts";
import "./lib/pgbase.ts";
import "./service/setup.service.ts";
import "./service/media.service.ts";
import { MaintenanceService } from "./service/maintenance.service.ts";

export async function startServer(): Promise<void> {
  const config = container.resolve(Config);
  const database = container.resolve(Database);
  const app = container.resolve(App);
  const maintenance = container.resolve(MaintenanceService);

  maintenance.start();

  const server = Bun.serve({ port: config.port, fetch: app.fetch });

  console.log(`[commerce] listening on ${server.url}`);
  console.log(`[commerce] auth  ${config.baseUrl}/api/auth`);
  console.log(`[commerce] rest  ${config.baseUrl}${config.basePath}`);

  const shutdown = async (signal: string) => {
    console.log(`[commerce] ${signal} received, shutting down`);
    maintenance.stop();
    server.stop(true);
    await database.destroy();
    await container.dispose();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

if (import.meta.main) {
  await startServer();
}
