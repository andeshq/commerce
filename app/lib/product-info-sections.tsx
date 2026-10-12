import { useState } from "react";
import { Alert, Button, Card, Dropdown, Input, Label, Modal, TextField } from "@heroui/react";
import { EllipsisVertical, Grip, Pencil, Plus, TrashBin } from "@gravity-ui/icons";
import { arrayMove } from "@dnd-kit/sortable";
import { pgbase, pgbaseErrorMessages } from "./pgbase";
import { SortableItem, SortableList, dragHandleClass } from "./sortable";
import { RichTextEditor } from "./rich-text-editor";
import { m } from "@/paraglide/messages.js";
import type { ProductInfoSection } from "./catalog";

/** Cap on how many info blocks a product may carry (Square-style 20). */
const MAX_SECTIONS = 20;

/** Plain-text preview of a rich-text body, collapsed onto a single line. */
function preview(body: string | null): string {
  if (!body) return "";
  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

interface Draft {
  id?: string;
  title: string;
  body: string;
}

/**
 * "Additional info sections" on the product detail page: a sortable list of
 * title + rich-text blocks (return policy, size chart, shipping). Writes go
 * straight to `product_info_sections`, like the image and variant editors.
 */
export function ProductInfoSections({
  productId,
  initialSections,
}: {
  productId: string;
  initialSections: ProductInfoSection[];
}) {
  const [sections, setSections] = useState(initialSections);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const atMax = sections.length >= MAX_SECTIONS;

  /** Writes 0..n-1 to the rows and returns them in display order. */
  async function persistOrder(list: ProductInfoSection[]): Promise<ProductInfoSection[]> {
    const ordered = list.map((section, position) => ({ ...section, position }));
    for (const section of ordered) {
      await pgbase
        .from("product_info_sections")
        .update({ position: section.position })
        .eq("id", section.id)
        .throwOnError();
    }
    return ordered;
  }

  async function save() {
    if (!draft) return;
    const title = draft.title.trim();
    if (!title) return;
    const body = draft.body.trim() ? draft.body : null;

    setBusy(true);
    setError(null);
    try {
      if (draft.id) {
        await pgbase
          .from("product_info_sections")
          .update({ title, body })
          .eq("id", draft.id)
          .throwOnError();
        setSections((current) =>
          current.map((section) =>
            section.id === draft.id ? { ...section, title, body } : section,
          ),
        );
      } else {
        const created = await pgbase
          .from("product_info_sections")
          .insert({ product_id: productId, title, body, position: sections.length })
          .select()
          .single()
          .throwOnError();
        setSections((current) => [...current, created.data as ProductInfoSection]);
      }
      setDraft(null);
    } catch (caught) {
      setError(pgbaseErrorMessages(caught)[0] ?? m.product_info_error());
    } finally {
      setBusy(false);
    }
  }

  async function remove(section: ProductInfoSection) {
    if (!window.confirm(m.product_info_delete_confirm({ title: section.title }))) return;

    setBusy(true);
    setError(null);
    try {
      await pgbase.from("product_info_sections").delete().eq("id", section.id).throwOnError();
      const next = sections.filter((item) => item.id !== section.id);
      setSections(await persistOrder(next));
    } catch (caught) {
      setError(pgbaseErrorMessages(caught)[0] ?? m.product_info_delete_error());
    } finally {
      setBusy(false);
    }
  }

  async function reorder(from: number, to: number) {
    const next = arrayMove(sections, from, to);
    setSections(next);
    setBusy(true);
    setError(null);
    try {
      setSections(await persistOrder(next));
    } catch (caught) {
      setError(pgbaseErrorMessages(caught)[0] ?? m.product_info_reorder_error());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>
          {m.product_info_title()}{" "}
          <span className="text-sm font-normal text-muted">
            {m.product_info_count({ count: sections.length, max: MAX_SECTIONS })}
          </span>
        </Card.Title>
        <Card.Description>{m.product_info_description()}</Card.Description>
      </Card.Header>
      <Card.Content>
        {error && (
          <Alert status="danger" className="mb-3">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert>
        )}

        {sections.length > 0 && (
          <SortableList
            ids={sections.map((section) => section.id)}
            onReorder={(from, to) => void reorder(from, to)}
          >
            <div className="flex flex-col">
              {sections.map((section) => (
                <SortableItem key={section.id} id={section.id}>
                  {({ itemRef, itemStyle, handleProps }) => (
                    <div
                      ref={itemRef}
                      style={itemStyle}
                      className="flex items-center gap-3 border-b border-field-border py-2.5 first:pt-0"
                    >
                      <button
                        type="button"
                        aria-label={m.product_info_reorder({ title: section.title })}
                        className={dragHandleClass}
                        {...handleProps}
                      >
                        <Grip className="size-4" />
                      </button>
                      <span className="w-56 shrink-0 truncate text-sm font-medium">
                        {section.title}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-muted">
                        {preview(section.body)}
                      </span>
                      <Dropdown>
                        <Button
                          isIconOnly
                          size="sm"
                          variant="tertiary"
                          aria-label={m.common_more_actions()}
                        >
                          <EllipsisVertical className="size-4" />
                        </Button>
                        <Dropdown.Popover placement="bottom end">
                          <Dropdown.Menu
                            onAction={(key) => {
                              if (key === "edit") {
                                setDraft({
                                  id: section.id,
                                  title: section.title,
                                  body: section.body ?? "",
                                });
                              }
                              if (key === "delete") void remove(section);
                            }}
                          >
                            <Dropdown.Item id="edit" textValue={m.common_edit()}>
                              <Pencil className="size-4 shrink-0 text-muted" />
                              <Label>{m.common_edit()}</Label>
                            </Dropdown.Item>
                            <Dropdown.Item
                              id="delete"
                              textValue={m.product_info_delete()}
                              variant="danger"
                            >
                              <TrashBin className="size-4 shrink-0 text-danger" />
                              <Label>{m.product_info_delete()}</Label>
                            </Dropdown.Item>
                          </Dropdown.Menu>
                        </Dropdown.Popover>
                      </Dropdown>
                    </div>
                  )}
                </SortableItem>
              ))}
            </div>
          </SortableList>
        )}

        <div className="pt-3">
          <Button
            variant="tertiary"
            isDisabled={busy || atMax}
            onPress={() => setDraft({ title: "", body: "" })}
          >
            <Plus className="size-4" />
            {m.product_info_add()}
          </Button>
          {atMax && (
            <p className="pt-1 text-xs text-muted">{m.product_info_max({ max: MAX_SECTIONS })}</p>
          )}
        </div>
      </Card.Content>

      <Modal
        isOpen={draft !== null}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
      >
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[560px]">
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>
                  {draft?.id ? m.product_info_edit() : m.product_info_new()}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
                {draft && (
                  <>
                    <TextField
                      fullWidth
                      isRequired
                      value={draft.title}
                      onChange={(value) =>
                        setDraft((current) => (current ? { ...current, title: value } : current))
                      }
                    >
                      <Label>{m.product_info_name()}</Label>
                      <Input placeholder={m.product_info_name_placeholder()} />
                    </TextField>
                    <div className="flex flex-col gap-2">
                      <span className="text-sm font-medium">{m.product_info_body()}</span>
                      <RichTextEditor
                        key={draft.id ?? "new"}
                        value={draft.body}
                        isDisabled={busy}
                        placeholder={m.product_info_body_placeholder()}
                        onChange={(html) =>
                          setDraft((current) => (current ? { ...current, body: html } : current))
                        }
                      />
                    </div>
                  </>
                )}
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" isDisabled={busy} onPress={() => setDraft(null)}>
                  {m.common_cancel()}
                </Button>
                <Button
                  isDisabled={busy || !draft?.title.trim()}
                  isPending={busy}
                  onPress={() => void save()}
                >
                  {m.product_info_save()}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </Card>
  );
}
