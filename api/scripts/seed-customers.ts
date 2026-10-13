import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { SQL } from "bun";

/**
 * Demo storefront customers for the admin Customers screen. Creates customer
 * accounts with a credential account (Better Auth's own hasher, so sign-in
 * works) and links any existing orders that share the email — so the listing
 * shows realistic order counts and spend. Idempotent per email.
 *
 *   cd api && bun run seed:customers
 */

const sql = new SQL(process.env.DATABASE_URL!);

const PASSWORD = "supersecret123";

const customers = [
  { name: "Ana Torres", email: "ana@example.com" },
  { name: "Luis Gómez", email: "luis@example.com" },
  { name: "Marta Ríos", email: "marta@example.com" },
];

for (const customer of customers) {
  const existing = await sql<{ id: string }[]>`
    select id from auth."user" where email = ${customer.email}
  `;

  let id = existing[0]?.id;

  if (id) {
    console.log(`[seed:customers] ${customer.email} already exists`);
  } else {
    id = randomUUID();
    const hash = await hashPassword(PASSWORD);
    await sql`
      insert into auth."user" (id, name, email, "emailVerified", role)
      values (${id}, ${customer.name}, ${customer.email}, false, 'customer')
    `;
    await sql`
      insert into auth."account" (id, "accountId", "providerId", "userId", password, "updatedAt")
      values (${randomUUID()}, ${id}, 'credential', ${id}, ${hash}, now())
    `;
    console.log(`[seed:customers] customer ${customer.email} (password: ${PASSWORD})`);
  }

  await sql`
    update commerce.orders set customer_id = ${id}
    where email = ${customer.email} and customer_id is null
  `;

  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int as count from commerce.orders
    where email = ${customer.email} and customer_id = ${id}
  `;
  console.log(`[seed:customers] ${customer.email} → ${count} order(s) linked`);
}

await sql.end();
console.log("[seed:customers] done");
