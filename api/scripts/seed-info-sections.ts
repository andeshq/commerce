import { SQL } from "bun";

/**
 * Demo "additional info sections" for the seeded products: product info, a
 * return policy, a size chart and shipping notes. Idempotent — skips once any
 * section exists, so it never duplicates on an existing catalog.
 *
 *   cd api && bun run seed:info-sections
 */

const sql = new SQL(process.env.DATABASE_URL!);

const [{ count }] = await sql`
  select count(*)::int as count from commerce.product_info_sections
`;
if (count > 0) {
  console.log(`[seed:info-sections] skipped — ${count} sections already exist`);
  await sql.end();
  process.exit(0);
}

/** Keyed by product slug; each entry is one section in display order. */
const SECTIONS: Record<string, Array<{ title: string; body: string }>> = {
  "camiseta-basica": [
    {
      title: "Información del producto",
      body:
        "<p>Camiseta de algodón peinado 100% colombiano, corte regular y costuras reforzadas. " +
        "Lavar a máquina en frío y secar a la sombra.</p>",
    },
    {
      title: "Política de devoluciones",
      body:
        "<p>Aceptamos cambios y devoluciones dentro de los 30 días posteriores a la compra, " +
        "con la prenda sin uso y en su empaque original.</p>" +
        "<ul><li>Cambios de talla sin costo en tienda.</li>" +
        "<li>Reembolso al medio de pago original en 5 días hábiles.</li></ul>",
    },
    {
      title: "Envíos",
      body:
        "<p>Enviamos a todo el país en 2 a 5 días hábiles. " +
        "Envío gratis en compras superiores a $150.000.</p>",
    },
  ],
  "hoodie-cordillera": [
    {
      title: "Guía de tallas",
      body:
        "<ul><li>S — pecho 96 cm</li><li>M — pecho 104 cm</li>" +
        "<li>L — pecho 112 cm</li><li>XL — pecho 120 cm</li></ul>",
    },
    {
      title: "Cuidados",
      body: "<p>Felpado interior. Lavar del revés en frío y evitar la secadora para conservar el tejido.</p>",
    },
  ],
  "gorra-sierra": [
    {
      title: "Información del producto",
      body: "<p>Gorra de sarga de algodón con cierre ajustable y visera curva. Talla única.</p>",
    },
  ],
};

const products = await sql`select id, slug from commerce.products`;

for (const product of products) {
  const plan = SECTIONS[product.slug];
  if (!plan) continue;

  for (const [position, section] of plan.entries()) {
    await sql`
      insert into commerce.product_info_sections (product_id, title, body, position)
      values (${product.id}, ${section.title}, ${section.body}, ${position})
    `;
  }
  console.log(`[seed:info-sections] ${product.slug} → ${plan.length} sections`);
}

await sql.end();
console.log("[seed:info-sections] done");
