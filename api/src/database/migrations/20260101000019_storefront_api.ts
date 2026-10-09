import { sql, type Kysely } from "kysely";

/**
 * Curated storefront read model.
 *
 * `commerce.variant_in_stock` is the one public stock probe: inventory is
 * staff-only by RLS, so a SECURITY DEFINER helper (at the default location,
 * matching checkout) exposes a boolean without publishing the ledger.
 *
 * The two views are `security_invoker`, so RLS still decides active-vs-draft:
 * anon sees active products only, staff sees everything. They are flat on
 * purpose — pgbase only infers embeds from simple projections, and the product
 * page goes through `commerce.storefront_product` instead.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    create or replace function commerce.variant_in_stock(variant uuid)
      returns boolean
      language sql stable security definer set search_path = ''
    as $$
      select coalesce((
        select il.available > 0
        from commerce.inventory_levels il
        join commerce.inventory_locations l on l.id = il.location_id
        where il.variant_id = variant and l.is_default
        limit 1
      ), false)
    $$;
    revoke all on function commerce.variant_in_stock(uuid) from public;
    grant execute on function commerce.variant_in_stock(uuid)
      to web_anon, web_customer, web_staff, web_admin;
  `).execute(db);

  await sql.raw(`
    create view commerce.storefront_products
    with (security_invoker = true)
    as
    select
      p.id,
      p.title,
      p.slug,
      p.vendor,
      p.product_type,
      p.description,
      p.category_id,
      c.name as category_name,
      c.slug as category_slug,
      p.published_at,
      min(v.price_cents)::text as price_min_cents,
      max(v.price_cents)::text as price_max_cents,
      min(v.compare_at_price_cents)::text as compare_at_min_cents,
      count(v.id)::int as variant_count,
      coalesce(bool_or(commerce.variant_in_stock(v.id)), false) as in_stock,
      (
        select m.url from commerce.product_media pm
        join commerce.media m on m.id = pm.media_id
        where pm.product_id = p.id
        order by pm.position, m.created_at
        limit 1
      ) as image_url,
      (
        select m.alt from commerce.product_media pm
        join commerce.media m on m.id = pm.media_id
        where pm.product_id = p.id
        order by pm.position, m.created_at
        limit 1
      ) as image_alt,
      to_tsvector(
        'spanish',
        coalesce(p.title, '') || ' ' || coalesce(p.vendor, '') || ' ' || coalesce(p.description, '')
      ) as search
    from commerce.products p
    left join commerce.categories c on c.id = p.category_id
    left join commerce.product_variants v on v.product_id = p.id
    group by p.id, c.name, c.slug;

    grant select on commerce.storefront_products to web_anon, web_customer, web_staff, web_admin;

    create view commerce.storefront_categories
    with (security_invoker = true)
    as
    select
      c.id,
      c.parent_id,
      c.name,
      c.slug,
      c.description,
      c.position,
      count(distinct p.id)::int as product_count
    from commerce.categories c
    left join commerce.products p on p.category_id = c.id
    group by c.id;

    grant select on commerce.storefront_categories to web_anon, web_customer, web_staff, web_admin;

    -- Expression index for the FTS column (must use an explicit config).
    create index products_search_idx on commerce.products
      using gin (
        to_tsvector(
          'spanish',
          coalesce(title, '') || ' ' || coalesce(vendor, '') || ' ' || coalesce(description, '')
        )
      );
  `).execute(db);

  // The product page in one call. SECURITY INVOKER (the default): RLS hides
  // drafts, so a non-visible slug simply returns null.
  await sql.raw(`
    create or replace function commerce.storefront_product(p_slug text) returns jsonb
      language sql stable set search_path = ''
    as $$
      select jsonb_build_object(
        'id', p.id,
        'title', p.title,
        'slug', p.slug,
        'description', p.description,
        'vendor', p.vendor,
        'product_type', p.product_type,
        'category_id', p.category_id,
        'published_at', p.published_at,
        'variants', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', v.id,
            'title', v.title,
            'sku', v.sku,
            'barcode', v.barcode,
            'price_cents', v.price_cents::text,
            'compare_at_price_cents', v.compare_at_price_cents::text,
            'requires_shipping', v.requires_shipping,
            'taxable', v.taxable,
            'in_stock', commerce.variant_in_stock(v.id),
            'option_values', coalesce((
              select jsonb_agg(jsonb_build_object(
                'option_id', ov.option_id, 'option_name', o.name, 'value', ov.value
              ) order by ov.position)
              from commerce.variant_option_values vov
              join commerce.option_values ov on ov.id = vov.option_value_id
              join commerce.options o on o.id = ov.option_id
              where vov.variant_id = v.id
            ), '[]'::jsonb),
            'media', coalesce((
              select jsonb_agg(jsonb_build_object('url', m.url, 'alt', m.alt)
                               order by m.created_at)
              from commerce.variant_media vm
              join commerce.media m on m.id = vm.media_id
              where vm.variant_id = v.id
            ), '[]'::jsonb)
          ) order by v.position)
          from commerce.product_variants v
          where v.product_id = p.id
        ), '[]'::jsonb),
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', o.id,
            'name', o.name,
            'values', coalesce((
              select jsonb_agg(jsonb_build_object('id', ov.id, 'value', ov.value)
                               order by ov.position)
              from commerce.option_values ov
              where ov.option_id = o.id
            ), '[]'::jsonb)
          ) order by po.position)
          from commerce.product_options po
          join commerce.options o on o.id = po.option_id
          where po.product_id = p.id
        ), '[]'::jsonb),
        'modifiers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', g.id,
            'name', g.name,
            'selection_type', g.selection_type,
            'required', g.required,
            'values', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', mv.id, 'name', mv.name, 'price_delta_cents', mv.price_delta_cents::text
              ) order by mv.position)
              from commerce.modifier_values mv
              where mv.group_id = g.id
            ), '[]'::jsonb)
          ) order by pmg.position)
          from commerce.product_modifier_groups pmg
          join commerce.modifier_groups g on g.id = pmg.group_id
          where pmg.product_id = p.id
        ), '[]'::jsonb),
        'media', coalesce((
          select jsonb_agg(jsonb_build_object(
            'url', m.url, 'alt', m.alt, 'width', m.width, 'height', m.height
          ) order by pm.position, m.created_at)
          from commerce.product_media pm
          join commerce.media m on m.id = pm.media_id
          where pm.product_id = p.id
        ), '[]'::jsonb)
      )
      from commerce.products p
      where p.slug = p_slug
    $$;

    revoke all on function commerce.storefront_product(text) from public;
    grant execute on function commerce.storefront_product(text)
      to web_anon, web_customer, web_staff, web_admin;
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    drop function if exists commerce.storefront_product(text);
    drop index if exists commerce.products_search_idx;
    drop view if exists commerce.storefront_categories;
    drop view if exists commerce.storefront_products;
    drop function if exists commerce.variant_in_stock(uuid);
  `).execute(db);
}
