import { runMigrateCli, type MigrateDirection } from "./database/migrate.ts";
import { startServer } from "./main.ts";

/**
 * Single entrypoint for the compiled binary.
 *
 *   serve        apply migrations, then serve (container default)
 *   start        serve only
 *   migrate      apply migrations (up | down | list)
 *   healthcheck  probe the local /health endpoint (exit 0/1)
 */
const [command, argument] = process.argv.slice(2);

async function healthcheck(): Promise<never> {
  const port = process.env.PORT ?? "8080";
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    process.exit(response.ok ? 0 : 1);
  } catch {
    process.exit(1);
  }
}

switch (command) {
  case "migrate":
    await runMigrateCli((argument ?? "up") as MigrateDirection);
    break;
  case "healthcheck":
    await healthcheck();
    break;
  case "start":
    await startServer();
    break;
  case "serve":
  default:
    await runMigrateCli("up");
    await startServer();
}
