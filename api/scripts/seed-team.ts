import { SQL } from "bun";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";

/**
 * Demo team members for the admin Team screen. Creates a second admin and a
 * staff account directly in the `auth` schema with a credential account, using
 * Better Auth's own password hasher so sign-in works. Idempotent per email.
 *
 *   cd api && bun run seed:team
 */

const sql = new SQL(process.env.DATABASE_URL!);

const PASSWORD = "supersecret123";

const members = [
  { name: "Camila Restrepo", email: "camila@andeshq.dev", role: "staff" },
  { name: "Diego Salazar", email: "diego@andeshq.dev", role: "admin" },
];

for (const member of members) {
  const existing = await sql<{ id: string }[]>`
    select id from auth."user" where email = ${member.email}
  `;
  if (existing.length > 0) {
    console.log(`[seed:team] skipped — ${member.email} already exists`);
    continue;
  }

  const id = randomUUID();
  const hash = await hashPassword(PASSWORD);

  await sql`
    insert into auth."user" (id, name, email, "emailVerified", role)
    values (${id}, ${member.name}, ${member.email}, false, ${member.role})
  `;
  await sql`
    insert into auth."account" (id, "accountId", "providerId", "userId", password, "updatedAt")
    values (${randomUUID()}, ${id}, 'credential', ${id}, ${hash}, now())
  `;

  console.log(`[seed:team] ${member.role} ${member.email} (password: ${PASSWORD})`);
}

await sql.end();
console.log("[seed:team] done");
