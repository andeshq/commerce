import { SQL } from "bun";
import { deflateSync } from "node:zlib";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Demo images for the seeded products: gradients generated as real PNGs on
 * disk (no binary assets in the repo) plus their `commerce.media` rows and
 * `product_media` links. Idempotent: skips once any media exists.
 *
 *   cd api && bun run seed:media
 */

const DIRECTORY = fileURLToPath(new URL("../storage/media/", import.meta.url));
const SIZE = 1200;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const SEEDS: Array<{ slug: string; gradients: Array<[string, string, string]> }> = [
  {
    slug: "camiseta-basica",
    gradients: [
      ["#ed5229", "#f7b267", "Camiseta Básica naranja"],
      ["#1e1c16", "#878787", "Camiseta Básica gris"],
    ],
  },
  {
    slug: "hoodie-cordillera",
    gradients: [["#2f4858", "#86bbd8", "Hoodie Cordillera azul"]],
  },
  {
    slug: "gorra-sierra",
    gradients: [["#6b705c", "#ddbea9", "Gorra Sierra verde"]],
  },
  {
    slug: "camiseta-edicion-2025",
    gradients: [["#4a4e69", "#c9ada7", "Camiseta Edición 2025"]],
  },
];

function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const payload = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, crc]);
}

/** Vertical gradient between two hex colours, encoded as a PNG. */
function gradientPng(from: string, to: string): Buffer {
  const parse = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = parse(from);
  const [r2, g2, b2] = parse(to);

  const stride = 1 + SIZE * 3;
  const raw = Buffer.alloc(SIZE * stride);
  for (let y = 0; y < SIZE; y++) {
    const t = y / (SIZE - 1);
    const offset = y * stride;
    raw[offset] = 0; // filter: none
    for (let x = 0; x < SIZE; x++) {
      const at = offset + 1 + x * 3;
      raw[at] = Math.round(r1 + (r2 - r1) * t);
      raw[at + 1] = Math.round(g1 + (g2 - g1) * t);
      raw[at + 2] = Math.round(b1 + (b2 - b1) * t);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const sql = new SQL(process.env.DATABASE_URL!);

const [{ count }] = await sql`select count(*)::int as count from commerce.media`;
if (count > 0) {
  console.log(`[seed:media] skipped — ${count} media rows already exist`);
  await sql.end();
  process.exit(0);
}

await mkdir(DIRECTORY, { recursive: true });

for (const seed of SEEDS) {
  const [product] = await sql`
    select id from commerce.products where slug = ${seed.slug}
  `;
  if (!product) {
    console.log(`[seed:media] product ${seed.slug} not found, skipping`);
    continue;
  }

  for (const [position, [from, to, alt]] of seed.gradients.entries()) {
    const id = crypto.randomUUID();
    const filename = `${id}.png`;
    await Bun.write(DIRECTORY + filename, gradientPng(from, to));

    await sql`
      insert into commerce.media (id, url, alt, content_type, width, height)
      values (${id}, ${`/media/${filename}`}, ${alt}, 'image/png', ${SIZE}, ${SIZE})
    `;
    await sql`
      insert into commerce.product_media (product_id, media_id, position)
      values (${product.id}, ${id}, ${position})
    `;
    console.log(`[seed:media] ${seed.slug} ← ${filename}`);
  }
}

await sql.end();
console.log("[seed:media] done");
