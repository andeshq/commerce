import { singleton } from "tsyringe";
import { sql } from "kysely";
import { Database } from "../database/database.ts";
import { MAINTENANCE_INTERVAL_MS, ORDER_EXPIRY_MINUTES } from "../config/config.ts";

/**
 * Periodic housekeeping. Today it cancels unpaid orders past the expiry window
 * and restocks them.
 *
 * It is safe to run on every replica: `commerce.expire_stale_orders` takes a
 * transaction-scoped advisory lock (one runner per tick) and claims orders with
 * `for update skip locked`, so concurrent sweeps never double-process an order.
 */
@singleton()
export class MaintenanceService {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly database: Database) {}

  /** Start the interval. Called from `main.ts`, never in tests. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sweep(), MAINTENANCE_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Cancel unpaid orders older than the window; returns how many expired. */
  async sweep(): Promise<number> {
    const before = new Date(Date.now() - ORDER_EXPIRY_MINUTES * 60_000);
    const result = await sql<{ expired: number }>`
      select commerce.expire_stale_orders(${before}) as expired
    `.execute(this.database);
    const expired = Number(result.rows[0]?.expired ?? 0);
    if (expired > 0) {
      console.log(`[commerce] expired ${expired} unpaid order(s)`);
    }
    return expired;
  }
}
