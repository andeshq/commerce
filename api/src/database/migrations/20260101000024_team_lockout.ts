import { sql, type Kysely } from "kysely";

/**
 * Lockout guard: the instance must always keep at least one active admin.
 *
 * Better Auth's admin plugin blocks banning/removing *yourself*, but nothing
 * stops an admin from demoting or deleting the only other admin — leaving zero
 * admins and no way back in. Enforced in the database so it holds no matter
 * which transport (or tool) mutates `auth."user"`.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    create or replace function auth.keep_one_admin() returns trigger
      language plpgsql as $$
      begin
        if tg_op = 'DELETE' then
          if old.role = 'admin' and not coalesce(old.banned, false)
             and not exists (
               select 1 from auth."user"
               where id <> old.id and role = 'admin' and not coalesce(banned, false)
             ) then
            raise exception 'cannot remove the last admin';
          end if;
          return old;
        end if;

        -- Fire only when an active admin stops being one.
        if old.role = 'admin' and not coalesce(old.banned, false)
           and (new.role is distinct from 'admin' or coalesce(new.banned, false))
           and not exists (
             select 1 from auth."user"
             where id <> old.id and role = 'admin' and not coalesce(banned, false)
           ) then
          raise exception 'cannot remove the last admin';
        end if;

        return new;
      end;
      $$;

    drop trigger if exists keep_one_admin on auth."user";
    create trigger keep_one_admin
      before update or delete on auth."user"
      for each row execute function auth.keep_one_admin();
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    drop trigger if exists keep_one_admin on auth."user";
    drop function if exists auth.keep_one_admin();
  `).execute(db);
}
