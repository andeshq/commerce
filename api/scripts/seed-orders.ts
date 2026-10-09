import { SQL } from "bun";

/**
 * Demo orders for the admin Orders screens. Builds carts, checks them out
 * through `commerce.checkout`, then moves a couple to paid/fulfilled. Skips
 * once any order exists. Needs the catalog + a default location.
 *
 *   cd api && bun run seed:orders
 */

const sql = new SQL(process.env.DATABASE_URL!);

const [{ count }] = await sql<{ count: number }[]>`
  select count(*)::int as count from commerce.orders
`;
if (count > 0) {
  console.log(`[seed:orders] skipped — ${count} orders already exist`);
  await sql.end();
  process.exit(0);
}

const [{ count: defaultCount }] = await sql<{ count: number }[]>`
  select count(*)::int as count from commerce.inventory_locations where is_default
`;
if (defaultCount === 0) {
  console.error("[seed:orders] no default location — run seed:inventory first");
  await sql.end();
  process.exit(1);
}

const variants = await sql<{ id: string; price_cents: number }[]>`
  select v.id, v.price_cents
  from commerce.product_variants v
  join commerce.products p on p.id = v.product_id
  join commerce.inventory_levels il on il.variant_id = v.id
  join commerce.inventory_locations l on l.id = il.location_id and l.is_default
  where p.status = 'active' and v.price_cents > 0 and il.available > 5
  order by p.created_at, v.position
  limit 6
`;
if (variants.length === 0) {
  console.error("[seed:orders] no in-stock variants — run seed:inventory first");
  await sql.end();
  process.exit(1);
}

const customers = [
  {
    email: "ana@example.com",
    address: { line1: "Cra 7 #12-34", city: "Bogotá", country: "Colombia" },
  },
  {
    email: "luis@example.com",
    address: { line1: "Calle 10 #4-5", city: "Medellín", country: "Colombia" },
  },
  {
    email: "marta@example.com",
    address: { line1: "Av 6N #23", city: "Cali", country: "Colombia" },
  },
];

const plans = [
  { items: [0, 1], pay: true, fulfill: true },
  { items: [2], pay: true, fulfill: false },
  { items: [3, 4, 5], pay: false, fulfill: false },
];

for (const [index, plan] of plans.entries()) {
  const customer = customers[index % customers.length];

  const cart = await sql<{ token: string }[]>`
    select token from commerce.cart_create(${customer.email})
  `;
  const token = cart[0]!.token;

  for (const itemIndex of plan.items) {
    const variant = variants[itemIndex % variants.length]!;
    await sql`select commerce.cart_add_item(${token}, ${variant.id}::uuid, 1)`;
  }

  const [order] = await sql<{ order_id: string; number: string }[]>`
    select * from commerce.checkout(
      ${token},
      ${customer.email},
      ${JSON.stringify(customer.address)}::jsonb
    )
  `;

  if (plan.pay) {
    await sql`update commerce.payments set status = 'paid' where order_id = ${order!.order_id}`;
    await sql`update commerce.orders set payment_status = 'paid' where id = ${order!.order_id}`;
    await sql`
      insert into commerce.order_events (order_id, type, data)
      values (${order!.order_id}, 'payment', jsonb_build_object('status', 'paid'))
    `;
  }
  if (plan.fulfill) {
    await sql`
      update commerce.orders
      set status = 'completed', fulfillment_status = 'fulfilled'
      where id = ${order!.order_id}
    `;
    await sql`
      insert into commerce.order_events (order_id, type, data)
      values (${order!.order_id}, 'fulfilled', '{}'::jsonb)
    `;
  }

  console.log(`[seed:orders] #${order!.number} ${customer.email} ${plan.pay ? "paid" : "pending"}`);
}

await sql.end();
console.log("[seed:orders] done");
