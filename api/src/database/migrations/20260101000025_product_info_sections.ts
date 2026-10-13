import { type Kysely, sql } from "kysely";

/**
 * Additional info sections: free-form rich-text blocks attached to a product
 * (return policy, size chart, shipping). Storefront-visible for active products
 * through the same active-product policy the other product children use; staff
 * and admins write. The one-call `storefront_product` page is extended with the
 * sections so a storefront needs no extra round trip.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(`
    create table commerce.product_info_sections (
      id uuid primary key default gen_random_uuid(),
      product_id uuid not null references commerce.products (id) on delete cascade,
      title text not null,
      body text,
      position integer not null default 0,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index product_info_sections_product_id_idx
      on commerce.product_info_sections (product_id);

    create trigger product_info_sections_updated_at
      before update on commerce.product_info_sections
      for each row execute function commerce.set_updated_at();

    grant select, insert, update, delete on commerce.product_info_sections
      to web_staff, web_admin;
    grant select on commerce.product_info_sections to web_anon, web_customer;

    alter table commerce.product_info_sections enable row level security;

    create policy product_info_sections_read on commerce.product_info_sections
      for select using (
        commerce.is_staff() or exists (
          select 1 from commerce.products p
          where p.id = product_info_sections.product_id and p.status = 'active'
        )
      );
    create policy product_info_sections_write on commerce.product_info_sections
      for all using (commerce.is_staff()) with check (commerce.is_staff());
  `)
    .execute(db);

  // Re-declare the product page with the new `info_sections` key.
  await sql
    .raw(`
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
        'info_sections', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', s.id, 'title', s.title, 'body', s.body
          ) order by s.position)
          from commerce.product_info_sections s
          where s.product_id = p.id
        ), '[]'::jsonb),
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
  `)
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql
    .raw(`
    drop table if exists commerce.product_info_sections;
  `)
    .execute(db);

  // Restore the pre-migration product page (without `info_sections`) so a
  // single-step rollback leaves a callable function behind.
  await sql
    .raw(`
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
  `)
    .execute(db);
}
