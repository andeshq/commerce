import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A `bun build --compile` binary runs from Bun's virtual filesystem
 * (`/$bunfs`), so paths relative to source no longer resolve. Anchor them to
 * the executable's directory instead; in development use the repository root.
 */
const isCompiled = import.meta.dir.startsWith("/$bunfs");

export const APP_ROOT = isCompiled
  ? path.dirname(process.execPath)
  : fileURLToPath(new URL("../../../", import.meta.url));

/** Built admin UI, served by the API in production. */
export const STATIC_DIR = path.join(APP_ROOT, "app", "dist");

/** Image bytes on local disk (mounted as a volume in the container). */
export const MEDIA_DIR = path.join(APP_ROOT, "api", "storage", "media");
