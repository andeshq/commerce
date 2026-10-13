import { S3Client } from "bun";

export type StorageConfig =
  | { driver: "local" }
  | {
      driver: "s3";
      endpoint: string;
      region: string;
      bucket: string;
      prefix: string;
      forcePathStyle: boolean;
      accessKeyId?: string;
      secretAccessKey?: string;
      publicBaseUrl: string;
    };

const FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,4}$/;

export function isStorageFilename(name: string): boolean {
  return FILENAME.test(name);
}

// Unset STORAGE_URL means local disk. Otherwise:
//   s3://ACCESS:SECRET@host/bucket[/prefix]?region=… (https)
//   s3+http://… (http, e.g. local MinIO). Omit userinfo for IAM roles.
// Public <img> base comes from STORAGE_PUBLIC_BASE_URL, else the
// `publicBaseUrl` query param, else endpoint/bucket.
export function parseStorageUrl(
  raw: string | undefined,
  publicBaseUrlOverride?: string,
): StorageConfig {
  if (!raw?.trim()) return { driver: "local" };

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Invalid STORAGE_URL: not a URL.");
  }

  const scheme = url.protocol.replace(/:$/, "");
  const insecure = scheme === "s3+http";
  if (scheme !== "s3" && scheme !== "s3+https" && !insecure) {
    throw new Error(`Invalid STORAGE_URL: scheme must be s3://, s3+https:// or s3+http://.`);
  }
  if (!url.hostname) throw new Error("Invalid STORAGE_URL: missing host.");

  const segments = url.pathname.split("/").filter(Boolean);
  const bucket = segments[0];
  if (!bucket) throw new Error("Invalid STORAGE_URL: missing bucket.");

  const params = url.searchParams;
  const pathStyleParam = params.get("forcePathStyle") ?? params.get("pathStyle");
  const forcePathStyle =
    pathStyleParam === null ? !url.hostname.endsWith("amazonaws.com") : pathStyleParam !== "false";

  let prefix = params.get("prefix") ?? segments.slice(1).join("/");
  if (prefix && !prefix.endsWith("/")) prefix += "/";
  if (prefix.startsWith("/")) prefix = prefix.slice(1);

  const endpoint = `${insecure ? "http" : "https"}://${url.host}`;
  const publicBaseUrl = (
    publicBaseUrlOverride?.trim() ||
    params.get("publicBaseUrl") ||
    `${endpoint}/${bucket}`
  ).replace(/\/$/, "");
  try {
    new URL(publicBaseUrl);
  } catch {
    throw new Error("Invalid STORAGE_PUBLIC_BASE_URL: not a URL.");
  }

  return {
    driver: "s3",
    endpoint,
    region: params.get("region") ?? "us-east-1",
    bucket,
    prefix,
    forcePathStyle,
    accessKeyId: url.username ? decodeURIComponent(url.username) : undefined,
    secretAccessKey: url.password ? decodeURIComponent(url.password) : undefined,
    publicBaseUrl,
  };
}

export function storageKeyFor(config: StorageConfig, filename: string): string {
  if (config.driver !== "s3") return filename;
  return `${config.prefix}${filename}`;
}

export function publicUrlFor(config: StorageConfig, filename: string): string | null {
  if (config.driver !== "s3") return null;
  return `${config.publicBaseUrl}/${storageKeyFor(config, filename)}`;
}

export function filenameFromUrl(url: string): string | null {
  const last = url.split("?")[0]?.split("/").pop();
  return last && FILENAME.test(last) ? last : null;
}

export function createS3Client(config: Extract<StorageConfig, { driver: "s3" }>): S3Client {
  return new S3Client({
    bucket: config.bucket,
    endpoint: config.endpoint,
    region: config.region,
    virtualHostedStyle: !config.forcePathStyle,
    ...(config.accessKeyId && config.secretAccessKey
      ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
      : {}),
  });
}

// Bun's S3 client has no Cache-Control option; caching is left to the CDN in
// front of publicBaseUrl.
export async function putS3Object(
  client: S3Client,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  await client.write(key, bytes, { type: contentType });
}

export async function deleteS3Object(client: S3Client, key: string): Promise<void> {
  await client.delete(key);
}
