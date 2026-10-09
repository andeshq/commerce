import { SQL } from "bun";

/**
 * Demo stock for the inventory screens: two locations plus levels and a
 * movement history for the seeded products. Rebuilds stock for every variant of
 * every non-archived product so levels always equal the sum of their movements,
 * and skips once any movement exists (idempotent on a fresh catalog).
 *
 *   cd api && bun run seed:inventory
 */

type SeedReason =
  | "stock_received"
  | "inventory_recount"
  | "damage"
  | "theft"
  | "loss"
  | "restock_return";

interface Movement {
  /** Age in days, so history reads oldest → newest. */
  days: number;
  reason: SeedReason;
  delta: number;
  note?: string;
}

/** Movements per variant position; MAIN is "Tienda principal". */
const PLANS: Record<string, Array<{ main?: Movement[]; norte?: Movement[] }>> = {
  "camiseta-basica": [
    {
      main: [
        { days: 12, reason: "stock_received", delta: 24 },
        { days: 8, reason: "damage", delta: -1, note: "Manchada en bodega" },
      ],
      norte: [{ days: 10, reason: "stock_received", delta: 18 }],
    },
    {
      main: [
        { days: 20, reason: "stock_received", delta: 40 },
        { days: 6, reason: "inventory_recount", delta: -6, note: "Conteo físico" },
        { days: 4, reason: "theft", delta: -2, note: "Faltante en vitrina" },
        { days: 2, reason: "restock_return", delta: 3, note: "Cambio de cliente" },
      ],
      norte: [
        { days: 9, reason: "stock_received", delta: 25 },
        { days: 3, reason: "loss", delta: -5, note: "Dañadas en bodega" },
      ],
    },
    {
      main: [
        { days: 15, reason: "stock_received", delta: 20 },
        { days: 5, reason: "loss", delta: -4, note: "Etiquetas defectuosas" },
      ],
    },
  ],
  "hoodie-cordillera": [
    {
      main: [{ days: 14, reason: "stock_received", delta: 12 }],
      norte: [{ days: 12, reason: "stock_received", delta: 10 }],
    },
    { main: [{ days: 14, reason: "stock_received", delta: 8 }] },
    {
      main: [
        { days: 16, reason: "stock_received", delta: 5 },
        { days: 7, reason: "theft", delta: -5, note: "Hurtado del exhibidor" },
      ],
      norte: [
        { days: 16, reason: "stock_received", delta: 6 },
        { days: 6, reason: "damage", delta: -6, note: "Caja aplastada" },
      ],
    },
    { main: [{ days: 13, reason: "stock_received", delta: 9 }] },
    {
      main: [
        { days: 18, reason: "stock_received", delta: 14 },
        { days: 5, reason: "damage", delta: -6, note: "Costuras abiertas" },
      ],
      norte: [{ days: 10, reason: "stock_received", delta: 6 }],
    },
    { main: [{ days: 9, reason: "stock_received", delta: 4 }] },
    {},
    { main: [{ days: 12, reason: "stock_received", delta: 6 }] },
    { main: [{ days: 3, reason: "restock_return", delta: 3, note: "Cambio de talla" }] },
  ],
  "gorra-sierra": [{ main: [{ days: 18, reason: "stock_received", delta: 5 }] }],
};

/** Products created later (e.g. hand-made demos) get a small starting count. */
function fallbackPlans(count: number): Array<{ main?: Movement[] }> {
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return { main: [{ days: 14, reason: "stock_received" as const, delta: 12 }] };
    if (index === 1) return { main: [{ days: 14, reason: "stock_received" as const, delta: 6 }] };
    return {};
  });
}

const sql = new SQL(process.env.DATABASE_URL!);

const [{ count }] = await sql`
  select count(*)::int as count from commerce.inventory_movements
`;
if (count > 0) {
  console.log(`[seed:inventory] skipped — ${count} movements already exist`);
  await sql.end();
  process.exit(0);
}

for (const location of [
  { name: "Tienda principal", code: "MAIN" },
  { name: "Bodega Norte", code: "NORTE" },
]) {
  await sql`
    insert into commerce.inventory_locations (name, code)
    values (${location.name}, ${location.code})
    on conflict ((lower(code))) do update set name = excluded.name, active = true
  `;
}

// The primary store is where checkout takes stock from.
await sql`update commerce.inventory_locations set is_default = false where is_default`;
await sql`update commerce.inventory_locations set is_default = true where code = 'MAIN'`;

const locationIds = new Map<string, string>();
for (const row of await sql`select id, code from commerce.inventory_locations where code in ('MAIN', 'NORTE')`) {
  locationIds.set(row.code, row.id);
}

async function rebuild(variantId: string, plan: { main?: Movement[]; norte?: Movement[] }) {
  await sql`delete from commerce.inventory_movements where variant_id = ${variantId}`;
  await sql`delete from commerce.inventory_levels where variant_id = ${variantId}`;

  for (const [code, movements] of [
    [locationIds.get("MAIN"), plan.main],
    [locationIds.get("NORTE"), plan.norte],
  ] as Array<[string | undefined, Movement[] | undefined]>) {
    if (!code || !movements || movements.length === 0) continue;

    const total = movements.reduce((sum, movement) => sum + movement.delta, 0);
    if (total < 0) throw new Error(`Seed plan for ${variantId} would go negative`);

    for (const movement of movements) {
      await sql`
        insert into commerce.inventory_movements
          (variant_id, location_id, delta, reason, metadata, created_at)
        values
          (${variantId}, ${code}, ${movement.delta}, ${movement.reason},
           ${JSON.stringify(movement.note ? { note: movement.note } : {})}::text::jsonb,
           now() - (${movement.days} * interval '1 day'))
      `;
    }

    const newest = Math.min(...movements.map((movement) => movement.days));
    await sql`
      insert into commerce.inventory_levels (variant_id, location_id, available, updated_at)
      values (${variantId}, ${code}, ${total}, now() - (${newest} * interval '1 day'))
    `;
    console.log(`[seed:inventory] ${variantId} @ ${code} → ${total}`);
  }
}

const products = await sql`
  select id, slug from commerce.products where status <> 'archived' order by created_at
`;
for (const product of products) {
  const variants = await sql`
    select id from commerce.product_variants where product_id = ${product.id} order by position, title
  `;
  const plans = PLANS[product.slug] ?? fallbackPlans(variants.length);
  for (const [index, variant] of variants.entries()) {
    await rebuild(variant.id, plans[index] ?? {});
  }
}

await sql.end();
console.log("[seed:inventory] done");
