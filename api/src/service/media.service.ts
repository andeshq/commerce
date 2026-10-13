import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { S3Client } from "bun";
import { HTTPException } from "hono/http-exception";
import { singleton } from "tsyringe";
import { Config } from "../config/config.ts";
import { Database } from "../database/database.ts";
import { MEDIA_DIR } from "../lib/paths.ts";
import {
  createS3Client,
  deleteS3Object,
  filenameFromUrl,
  isStorageFilename,
  publicUrlFor,
  putS3Object,
  type StorageConfig,
  storageKeyFor,
} from "../lib/storage.ts";

const MAX_BYTES = 10 * 1024 * 1024;

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

export interface MediaRow {
  id: string;
  url: string;
  alt: string | null;
  content_type: string | null;
  width: number | null;
  height: number | null;
}

// Local disk by default, S3-compatible storage when STORAGE_URL is set.
// Local rows use the relative /api/media/files/<file> URL; S3 rows store the
// absolute public URL.
@singleton()
export class MediaService {
  private readonly directory = MEDIA_DIR;
  private readonly storage: StorageConfig;
  private s3: S3Client | null = null;

  constructor(
    private readonly database: Database,
    config: Config,
  ) {
    this.storage = config.storage;
  }

  private client(): S3Client {
    if (this.storage.driver !== "s3") throw new Error("S3 client used with local storage");
    if (!this.s3) this.s3 = createS3Client(this.storage);
    return this.s3;
  }

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

    const url =
      this.storage.driver === "s3"
        ? `${publicUrlFor(this.storage, filename)}`
        : `/api/media/files/${filename}`;

    if (this.storage.driver === "s3") {
      await putS3Object(this.client(), storageKeyFor(this.storage, filename), bytes, file.type);
    } else {
      await mkdir(this.directory, { recursive: true });
      await Bun.write(join(this.directory, filename), bytes);
    }

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
          url,
          alt: typeof alt === "string" && alt.trim() ? alt.trim() : null,
          content_type: file.type,
          width: dimensions.width,
          height: dimensions.height,
        })
        .returning(["id", "url", "alt", "content_type", "width", "height"])
        .executeTakeFirstOrThrow();

      return row as MediaRow;
    } catch (error) {
      await this.deleteBytes(filename).catch(() => {});
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

    const filename = filenameFromUrl(row.url);
    if (filename) {
      await this.deleteBytes(filename).catch(() => {});
    }
  }

  private async deleteBytes(filename: string): Promise<void> {
    if (this.storage.driver === "s3") {
      await deleteS3Object(this.client(), storageKeyFor(this.storage, filename));
      return;
    }
    await unlink(join(this.directory, filename)).catch(() => {});
  }

  async file(name: string): Promise<Bun.BunFile | null> {
    if (this.storage.driver !== "local") return null;
    if (!isStorageFilename(name)) return null;
    const file = Bun.file(join(this.directory, name));
    return (await file.exists()) ? file : null;
  }

  // Absolute public URL for the /api/media/files/:file shim on S3, so old
  // relative URLs keep working. Null on local disk (serve bytes directly).
  fileUrl(name: string): string | null {
    if (!isStorageFilename(name)) return null;
    if (this.storage.driver === "s3") return publicUrlFor(this.storage, name);
    return null;
  }
}
