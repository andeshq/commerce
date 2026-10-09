import { singleton } from "tsyringe";
import { HTTPException } from "hono/http-exception";
import { join } from "node:path";
import { mkdir, unlink } from "node:fs/promises";
import { Database } from "../database/database.ts";
import { MEDIA_DIR } from "../lib/paths.ts";

const MAX_BYTES = 10 * 1024 * 1024;

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

const FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,4}$/;

export interface MediaRow {
  id: string;
  url: string;
  alt: string | null;
  content_type: string | null;
  width: number | null;
  height: number | null;
}

/**
 * Image bytes live on local disk (`api/storage/media`) and their metadata in
 * `commerce.media`; `media.url` stays relative so the origin can move without
 * rewriting rows. Swapping in object storage later only changes this service.
 */
@singleton()
export class MediaService {
  private readonly directory = MEDIA_DIR;

  constructor(private readonly database: Database) {}

  async upload(request: Request): Promise<MediaRow> {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new HTTPException(400, { message: "Attach an image as the `file` field." });
    }

    const extension = EXTENSION_BY_TYPE[file.type];
    if (!extension) {
      throw new HTTPException(415, {
        message: `Unsupported image type: ${file.type || "unknown"}. Use JPEG, PNG, WebP, AVIF or GIF.`,
      });
    }
    if (file.size > MAX_BYTES) {
      throw new HTTPException(413, { message: "Images must be 10 MB or smaller." });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = crypto.randomUUID();
    const filename = `${id}.${extension}`;
    const alt = form.get("alt");

    await mkdir(this.directory, { recursive: true });
    await Bun.write(join(this.directory, filename), bytes);

    const dimensions = await new Bun.Image(bytes)
      .metadata()
      .then((meta) => ({ width: meta.width, height: meta.height }))
      .catch(() => ({ width: null, height: null }));

    try {
      const row = await this.database
        .withSchema("commerce")
        .insertInto("media")
        .values({
          id,
          url: `/api/media/files/${filename}`,
          alt: typeof alt === "string" && alt.trim() ? alt.trim() : null,
          content_type: file.type,
          width: dimensions.width,
          height: dimensions.height,
        })
        .returning(["id", "url", "alt", "content_type", "width", "height"])
        .executeTakeFirstOrThrow();

      return row as MediaRow;
    } catch (error) {
      // Never leave bytes on disk without their row.
      await unlink(join(this.directory, filename)).catch(() => {});
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    const row = await this.database
      .withSchema("commerce")
      .selectFrom("media")
      .select(["url"])
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row) throw new HTTPException(404, { message: "Image not found." });

    await this.database.withSchema("commerce").deleteFrom("media").where("id", "=", id).execute();

    const filename = row.url.split("/").pop();
    if (filename && FILENAME.test(filename)) {
      await unlink(join(this.directory, filename)).catch(() => {});
    }
  }

  async file(name: string): Promise<Bun.BunFile | null> {
    if (!FILENAME.test(name)) return null;
    const file = Bun.file(join(this.directory, name));
    return (await file.exists()) ? file : null;
  }
}
