import { type Kysely, sql } from "kysely";

/**
 * Manual collections on the storefront.
 *
 * `collections` / `product_collections` already exist with RLS and grants (the
 * catalog migration); this publishes the read model. Both views are
 * `security_invoker`, so RLS still decides active-vs-draft, and
 * `storefront_collection` reuses `storefront_products` so a collection's
 * products carry the same shape as a listing.
 *
 * `type = 'smart'` and the `rules` column stay unused in v1: only manual
 * collections are surfaced.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(`
    create view commerce.storefront_collections
    with (security_invoker = true)
    as
    select
      c.id,
      c.name,
      c.slug,
      c.description,
      c.position,
      count(distinct p.id)::int as product_count
    from commerce.collections c
    left join commerce.product_collections pc on pc.collection_id = c.id
    left join commerce.products p on p.id = pc.product_id
    group by c.id;

    grant select on commerce.storefront_collections to web_anon, web_customer, web_staff, web_admin;

    create or replace function commerce.storefront_collection(p_slug text) returns jsonb
      language sql stable set search_path = ''
    as $$
      select jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'slug', c.slug,
        'description', c.description,
        'products', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', sp.id,
            'title', sp.title,
            'slug', sp.slug,
            'price_min_cents', sp.price_min_cents,
            'price_max_cents', sp.price_max_cents,
            'compare_at_min_cents', sp.compare_at_min_cents,
            'in_stock', sp.in_stock,
            'image_url', sp.image_url,
            'image_alt', sp.image_alt
          ) order by pc.position, sp.title)
          from commerce.product_collections pc
          join commerce.storefront_products sp on sp.id = pc.product_id
          where pc.collection_id = c.id
        ), '[]'::jsonb)
      )
      from commerce.collections c
      where c.slug = p_slug
    $$;

    revoke all on function commerce.storefront_collection(text) from public;
    grant execute on function commerce.storefront_collection(text)
      to web_anon, web_customer, web_staff, web_admin;
  `)
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql
    .raw(`
    drop function if exists commerce.storefront_collection(text);
    drop view if exists commerce.storefront_collections;
  `)
    .execute(db);
}
