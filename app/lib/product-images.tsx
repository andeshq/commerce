import { useRef, useState } from "react";
import { Button, Input } from "@heroui/react";
import { Picture, Xmark } from "@gravity-ui/icons";
import { pgbase, pgbaseErrorMessages } from "./pgbase";

export interface ImageEntry {
  mediaId: string;
  url: string;
  alt: string | null;
}

/** Writes 0..n-1 to the product's image links, keeping their display order. */
async function renumber(productId: string, entries: ImageEntry[]) {
  for (const [position, item] of entries.entries()) {
    await pgbase
      .from("product_media")
      .update({ position })
      .eq("product_id", productId)
      .eq("media_id", item.mediaId)
      .throwOnError();
  }
}

/**
 * Uploads land in the image library immediately (`POST /api/media`). While
 * creating a product the ids are handed back so the create payload can link
 * them; on an existing product the link is written right away.
 */
export function ProductImages({
  productId,
  initialEntries,
  onChange,
  onDetached,
}: {
  productId?: string;
  initialEntries: ImageEntry[];
  onChange?(mediaIds: string[]): void;
  /** Notifies the parent so variant links to the detached image can be cleared. */
  onDetached?(mediaId: string): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState(initialEntries);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function report(next: ImageEntry[]) {
    setEntries(next);
    onChange?.(next.map((entry) => entry.mediaId));
  }

  async function upload(files: FileList) {
    setBusy(true);
    setError(null);
    try {
      const added: ImageEntry[] = [];
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/media", { method: "POST", body: form });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(body?.message ?? "Upload failed.");
        }

        const created = (await response.json()) as {
          id: string;
          url: string;
          alt: string | null;
        };
        if (productId) {
          await pgbase
            .from("product_media")
            .insert({
              product_id: productId,
              media_id: created.id,
              position: entries.length + added.length,
            })
            .throwOnError();
        }
        added.push({ mediaId: created.id, url: created.url, alt: created.alt });
      }
      report([...entries, ...added]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : pgbaseErrorMessages(caught)[0]);
    } finally {
      setBusy(false);
    }
  }

  async function detach(entry: ImageEntry) {
    const next = entries.filter((item) => item.mediaId !== entry.mediaId);
    setBusy(true);
    setError(null);
    try {
      if (productId) {
        await pgbase
          .from("product_media")
          .delete()
          .eq("product_id", productId)
          .eq("media_id", entry.mediaId)
          .throwOnError();
        await renumber(productId, next);
      }
      report(next);
      onDetached?.(entry.mediaId);
    } catch (caught) {
      setError(pgbaseErrorMessages(caught)[0] ?? "Could not detach the image.");
    } finally {
      setBusy(false);
    }
  }

  /** Alt text is stored on the media row, so it survives re-attachment. */
  async function saveAlt(entry: ImageEntry, value: string) {
    const alt = value.trim() || null;
    if ((entry.alt ?? "") === (alt ?? "")) return;

    setBusy(true);
    setError(null);
    try {
      await pgbase.from("media").update({ alt }).eq("id", entry.mediaId).throwOnError();
      report(
        entries.map((item) => (item.mediaId === entry.mediaId ? { ...item, alt } : item)),
      );
    } catch (caught) {
      setError(pgbaseErrorMessages(caught)[0] ?? "Could not save the alt text.");
    } finally {
      setBusy(false);
    }
  }

  async function makeMain(entry: ImageEntry) {
    const next = [entry, ...entries.filter((item) => item.mediaId !== entry.mediaId)];
    report(next);
    if (!productId) return;

    setBusy(true);
    setError(null);
    try {
      await renumber(productId, next);
    } catch (caught) {
      setError(pgbaseErrorMessages(caught)[0] ?? "Could not reorder the images.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {entries.map((entry, index) => (
          <div key={entry.mediaId} className="flex w-24 flex-col gap-1">
            <div className="relative">
              <button
                type="button"
                aria-label={`Set image ${index + 1} as the main image`}
                disabled={busy || index === 0}
                onClick={() => void makeMain(entry)}
                className={
                  "block overflow-hidden rounded-xl " +
                  (index === 0 ? "ring-2 ring-accent" : "hover:opacity-80")
                }
              >
                <img src={entry.url} alt={entry.alt ?? ""} className="size-24 object-cover" />
                {index === 0 && (
                  <span className="absolute start-1 bottom-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
                    Main
                  </span>
                )}
              </button>
              <Button
                aria-label={`Remove image ${index + 1}`}
                isIconOnly
                size="sm"
                variant="tertiary"
                className="absolute -end-2 -top-2"
                isDisabled={busy}
                onPress={() => void detach(entry)}
              >
                <Xmark className="size-3.5" />
              </Button>
            </div>
            <Input
              aria-label={`Alt text for image ${index + 1}`}
              className="text-xs"
              defaultValue={entry.alt ?? ""}
              placeholder="Alt text"
              disabled={busy || !productId}
              onBlur={(event) => void saveAlt(entry, event.target.value)}
            />
          </div>
        ))}

        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
          multiple
          hidden
          onChange={(event) => {
            const files = event.target.files;
            if (files && files.length > 0) void upload(files);
            event.target.value = "";
          }}
        />
        <Button variant="secondary" isDisabled={busy} onPress={() => input.current?.click()}>
          <Picture className="size-4" />
          {busy ? "Uploading…" : "Add images"}
        </Button>
      </div>

      {entries.length === 0 && !busy && (
        <p className="text-xs text-muted">JPEG, PNG, WebP, AVIF or GIF, up to 10 MB.</p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
