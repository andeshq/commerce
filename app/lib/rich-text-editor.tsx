import { useEffect, useRef, useState } from "react";
import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
} from "@lexical/list";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { Separator, ToggleButton, Toolbar } from "@heroui/react";
import { Bold, Italic, ListOl, ListUl, Underline } from "@gravity-ui/icons";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  FORMAT_TEXT_COMMAND,
  type EditorThemeClasses,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";

/**
 * Minimal Lexical editor: bold/italic/underline and lists. Value is HTML —
 * plain-text descriptions load into a paragraph and save back as HTML, and
 * empty documents serialize to `""` so the column stays null-friendly.
 */

const theme: EditorThemeClasses = {
  paragraph: "mb-2 last:mb-0",
  text: {
    bold: "font-semibold",
    italic: "italic",
    underline: "underline",
  },
  list: {
    ul: "mb-2 list-disc ps-5",
    ol: "mb-2 list-decimal ps-5",
    listitem: "mb-0.5",
  },
};

interface ToolbarFormats {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  list: "bullet" | "number" | null;
}

const NO_FORMATS: ToolbarFormats = { bold: false, italic: false, underline: false, list: null };

function sameFormats(a: ToolbarFormats, b: ToolbarFormats): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.list === b.list;
}

/** Loads the initial HTML once; later `value` changes never clobber edits. */
function InitialValuePlugin({ value }: { value: string }) {
  const [editor] = useLexicalComposerContext();
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current || !value) return;
    loaded.current = true;

    // Legacy descriptions are plain text; only element/decorator nodes may sit
    // at the root, so wrap anything that isn't HTML in a paragraph.
    const source = /<\/?[a-z][\s\S]*>/i.test(value) ? value : `<p>${value}</p>`;

    editor.update(() => {
      const dom = new DOMParser().parseFromString(source, "text/html");
      const nodes = $generateNodesFromDOM(editor, dom).map((node) =>
        $isTextNode(node) ? $createParagraphNode().append(node) : node,
      );

      const root = $getRoot();
      root.clear();
      root.append(...nodes.filter((node) => $isElementNode(node) || $isDecoratorNode(node)));
    });
  }, [editor, value]);

  return null;
}

function EditablePlugin({ isDisabled }: { isDisabled?: boolean }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(!isDisabled);
  }, [editor, isDisabled]);

  return null;
}

function ToolbarStatePlugin({
  onChange,
}: {
  onChange(formats: ToolbarFormats): void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;

        let list: ToolbarFormats["list"] = null;
        for (
          let node: LexicalNode | null = selection.anchor.getNode();
          node;
          node = node.getParent()
        ) {
          if ($isListNode(node)) {
            list = node.getListType() === "number" ? "number" : "bullet";
            break;
          }
        }

        onChange({
          bold: selection.hasFormat("bold"),
          italic: selection.hasFormat("italic"),
          underline: selection.hasFormat("underline"),
          list,
        });
      });
    });
  }, [editor, onChange]);

  return null;
}

export function RichTextEditor({
  value,
  onChange,
  onBlur,
  isDisabled,
  placeholder = "Describe the product…",
}: {
  value: string;
  onChange(html: string): void;
  onBlur?(): void;
  isDisabled?: boolean;
  placeholder?: string;
}) {
  const [formats, setFormats] = useState<ToolbarFormats>(NO_FORMATS);

  return (
    <LexicalComposer
      initialConfig={{
        namespace: "commerce",
        theme,
        nodes: [ListNode, ListItemNode],
        onError: (error: Error) => {
          // Never let an editor hiccup blank the whole page.
          console.error("[rich-text]", error);
        },
      }}
    >
      <div className="flex flex-col overflow-hidden rounded-field border border-field-border bg-field shadow-field focus-within:border-field-border-focus">
        <EditorToolbar formats={formats} isDisabled={isDisabled} />
        <div className="relative">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className="min-h-24 px-3 py-2 text-sm outline-none"
                onBlur={onBlur}
              />
            }
            placeholder={
              <p className="pointer-events-none absolute start-3 top-2 text-sm text-field-placeholder">
                {placeholder}
              </p>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
      </div>

      <ToolbarStatePlugin
        onChange={(next) => setFormats((current) => (sameFormats(current, next) ? current : next))}
      />
      <InitialValuePlugin value={value} />
      <EditablePlugin isDisabled={isDisabled} />
      <HistoryPlugin />
      <ListPlugin />
      <OnChangePlugin
        onChange={(_state, editor: LexicalEditor) => {
          const html = editor.getEditorState().read(() => {
            const text = $getRoot().getTextContent().trim();
            return text ? $generateHtmlFromNodes(editor) : "";
          });
          onChange(html);
        }}
      />
    </LexicalComposer>
  );
}

function EditorToolbar({
  formats,
  isDisabled,
}: {
  formats: ToolbarFormats;
  isDisabled?: boolean;
}) {
  const [editor] = useLexicalComposerContext();

  return (
    <Toolbar
      aria-label="Text formatting"
      className="flex items-center gap-1 border-b border-field-border px-2 py-1"
    >
      <ToggleButton
        isIconOnly
        aria-label="Bold"
        size="sm"
        isSelected={formats.bold}
        isDisabled={isDisabled}
        onChange={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
      >
        <Bold className="size-4" />
      </ToggleButton>
      <ToggleButton
        isIconOnly
        aria-label="Italic"
        size="sm"
        isSelected={formats.italic}
        isDisabled={isDisabled}
        onChange={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
      >
        <Italic className="size-4" />
      </ToggleButton>
      <ToggleButton
        isIconOnly
        aria-label="Underline"
        size="sm"
        isSelected={formats.underline}
        isDisabled={isDisabled}
        onChange={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline")}
      >
        <Underline className="size-4" />
      </ToggleButton>

      <Separator orientation="vertical" className="mx-1 h-5" />

      <ToggleButton
        isIconOnly
        aria-label="Bullet list"
        size="sm"
        isSelected={formats.list === "bullet"}
        isDisabled={isDisabled}
        onChange={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
      >
        <ListUl className="size-4" />
      </ToggleButton>
      <ToggleButton
        isIconOnly
        aria-label="Numbered list"
        size="sm"
        isSelected={formats.list === "number"}
        isDisabled={isDisabled}
        onChange={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}
      >
        <ListOl className="size-4" />
      </ToggleButton>
    </Toolbar>
  );
}
