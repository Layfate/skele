"use client";

import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import FileHandler from "@tiptap/extension-file-handler";
import DragHandle from "@tiptap/extension-drag-handle-react";
import { common, createLowlight } from "lowlight";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { isSafeUrl, sanitizeDoc } from "./doc";

import { BubbleToolbar } from "./bubble-toolbar";
import { Callout } from "./extensions/callout";
import { FileBlock } from "./extensions/file-block";
import { Bookmark } from "./extensions/bookmark";
import { SlashCommand } from "./extensions/slash-command";
import { SkeleStorageExtension, type SkeleHost, type Uploader } from "./extensions/skele-storage";
import { LocalImage } from "./extensions/local-image";
import { WikiLink } from "./extensions/wiki-link";
import { Autocorrect } from "./extensions/autocorrect";
import { usePreferences } from "@/features/settings/hooks";
import { autocorrectOptions } from "@/lib/autocorrect";
import "./editor.css";

/** The schema needs at least one block; stored empty documents are `{ type: "doc", content: [] }`. */
function editableDoc(input: unknown): JSONContent {
  const doc = sanitizeDoc(input);
  return (doc.content?.length ? doc : { type: "doc", content: [{ type: "paragraph" }] }) as JSONContent;
}

const lowlight = createLowlight(common);
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

async function insertFiles(editor: Editor, files: File[], pos?: number) {
  const upload = editor.storage.skele.upload;
  if (!upload) return;
  for (const file of files) {
    const id = toast.loading(`Uploading ${file.name}…`);
    try {
      const result = await upload(file);
      if (!result) continue;
      const node = IMAGE_TYPES.includes(result.mimeType)
        ? { type: "image", attrs: { src: result.url, alt: result.name } }
        : { type: "fileBlock", attrs: result };
      if (pos !== undefined) editor.chain().focus().insertContentAt(pos, node).run();
      else editor.chain().focus().insertContent(node).run();
      toast.success(`Uploaded ${file.name}`, { id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed", { id });
    }
  }
}

export type SkeleEditorProps = {
  /** Changing this key re-creates the editor (e.g. after a conflict reload). */
  docKey: string;
  initialContent: unknown;
  editable: boolean;
  onUpdate?: (doc: JSONContent) => void;
  upload?: Uploader;
  /** Page search/creation/navigation and attachment resolution for links and media. */
  host?: Partial<Omit<SkeleHost, "upload">>;
  placeholder?: string;
  autofocus?: boolean;
  onEditor?: (editor: Editor | null) => void;
};

export function SkeleEditor({
  docKey,
  initialContent,
  editable,
  onUpdate,
  upload,
  host,
  placeholder = "Type '/' for commands…",
  autofocus,
  onEditor,
}: SkeleEditorProps) {
  const onUpdateRef = useRef(onUpdate);
  const uploadRef = useRef(upload);
  const hostRef = useRef(host);
  const prefs = usePreferences();
  const autocorrectRef = useRef(autocorrectOptions(prefs.data?.autocorrect));
  useEffect(() => {
    onUpdateRef.current = onUpdate;
    uploadRef.current = upload;
    hostRef.current = host;
    autocorrectRef.current = autocorrectOptions(prefs.data?.autocorrect);
  });
  // Read when a word ends, so changes in Settings apply without reloading the page.
  const autocorrect = useCallback(() => autocorrectRef.current, []);
  // Plugins (e.g. the trailing paragraph) can normalise a document right after it loads.
  // Only report changes once the user has actually interacted with the editor.
  const interacted = useRef(false);

  const stableUpload = useCallback<Uploader>((file) => uploadRef.current?.(file) ?? Promise.resolve(null), []);
  // Stable wrappers: Tiptap keeps these for the editor's lifetime; they always call the latest props.
  const stableHost = useMemo<Omit<SkeleHost, "upload">>(
    () => ({
      searchPages: (q) => hostRef.current?.searchPages?.(q) ?? Promise.resolve([]),
      createPage: (title) => hostRef.current!.createPage!(title),
      openPage: (id) => hostRef.current?.openPage?.(id),
      resolveFile: (ref) => hostRef.current?.resolveFile?.(ref) ?? Promise.resolve(null),
      pageTitle: (id) => hostRef.current?.pageTitle?.(id),
    }),
    [],
  );

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable,
      autofocus: autofocus ? "start" : false,
      // Stored documents are normalised first; nodes the schema doesn't know are dropped.
      content: editableDoc(initialContent),
      enableContentCheck: true,
      onContentError: ({ disableCollaboration }) => {
        disableCollaboration?.();
        toast.error("Some content on this page couldn't be displayed and was skipped.");
      },
      extensions: [
        StarterKit.configure({
          codeBlock: false,
          heading: { levels: [1, 2, 3] },
          dropcursor: { color: "var(--brand)", width: 2 },
          link: {
            openOnClick: false,
            autolink: true,
            defaultProtocol: "https",
            isAllowedUri: (url) => isSafeUrl(url),
            HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
          },
        }),
        Placeholder.configure({
          includeChildren: false,
          placeholder: ({ node, editor: e }) => {
            if (node.type.name === "heading") return `Heading ${node.attrs.level}`;
            if (node.type.name === "detailsSummary") return "Toggle";
            if (e.isActive("table") || e.isActive("callout")) return "";
            return placeholder;
          },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Details.configure({ persist: true, HTMLAttributes: { class: "details" } }),
        DetailsSummary,
        DetailsContent,
        TableKit.configure({ table: { resizable: true } }),
        LocalImage.configure({ allowBase64: false }),
        WikiLink,
        TextStyle,
        Color,
        Highlight.configure({ multicolor: true }),
        CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
        Callout,
        FileBlock,
        Bookmark,
        SlashCommand,
        // Tiptap only stores this getter; it's called when a word ends, never during render.
        // eslint-disable-next-line react-hooks/refs
        Autocorrect.configure({ options: autocorrect }),
        // Stable wrapper so the latest upload callback is always used.
        // Tiptap only stores this callback; it runs on user uploads, never during render.
        // eslint-disable-next-line react-hooks/refs
        SkeleStorageExtension.configure({ upload: stableUpload, ...stableHost }),
        FileHandler.configure({
          allowedMimeTypes: undefined,
          onDrop: (e, files, pos) => void insertFiles(e, files, pos),
          onPaste: (e, files) => void insertFiles(e, files),
        }),
      ],
      editorProps: {
        handleDOMEvents: {
          keydown: () => ((interacted.current = true), false),
          mousedown: () => ((interacted.current = true), false),
          paste: () => ((interacted.current = true), false),
          drop: () => ((interacted.current = true), false),
        },
        attributes: {
          class: "skele-prose",
          "aria-label": "Page content",
          spellcheck: "true",
        },
      },
      onUpdate: ({ editor: e }) => {
        if (!e.isEditable || !interacted.current) return;
        onUpdateRef.current?.(e.getJSON());
      },
    },
    [docKey],
  );

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  if (!editor) return <div className="skele-prose min-h-40" aria-busy="true" />;

  return (
    <div className="relative">
      {editable && (
        <DragHandle editor={editor} className="skele-drag-handle">
          <div title="Drag to move" className="flex h-6 w-5 items-center justify-center rounded text-muted-foreground/70 hover:bg-accent hover:text-foreground">
            <GripVertical className="size-4" />
          </div>
        </DragHandle>
      )}
      <EditorContent editor={editor} />
      {editable && <BubbleToolbar editor={editor} />}
    </div>
  );
}
