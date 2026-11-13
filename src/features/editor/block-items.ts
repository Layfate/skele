import type { Editor, Range } from "@tiptap/core";
import {
  Bookmark,
  ChevronRight,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  List,
  ListChecks,
  ListOrdered,
  Megaphone,
  Minus,
  Paperclip,
  Pilcrow,
  Quote,
  Table,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { pickFile } from "./extensions/skele-storage";

export type BlockItem = {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  keywords: string[];
  group: "Basic" | "Media" | "Advanced";
  /** Markdown shortcut hint shown in the menu. */
  hint?: string;
  run: (editor: Editor, range: Range) => void;
};

const chain = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);

async function uploadAndInsert(editor: Editor, kind: "image" | "file") {
  const upload = editor.storage.skele.upload;
  if (!upload) return;
  const file = await pickFile(kind === "image" ? "image/png,image/jpeg,image/gif,image/webp" : undefined);
  if (!file) return;
  const id = toast.loading(`Uploading ${file.name}…`);
  try {
    const result = await upload(file);
    if (!result) return;
    if (kind === "image" || result.mimeType.startsWith("image/")) {
      editor.chain().focus().setImage({ src: result.url, alt: result.name }).run();
    } else {
      editor.chain().focus().insertFileBlock(result).run();
    }
    toast.success("Uploaded", { id });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Upload failed", { id });
  }
}

export const BLOCK_ITEMS: BlockItem[] = [
  {
    id: "paragraph",
    title: "Text",
    description: "Plain paragraph",
    icon: Pilcrow,
    keywords: ["paragraph", "text", "p"],
    group: "Basic",
    run: (e, r) => chain(e, r).setParagraph().run(),
  },
  {
    id: "h1",
    title: "Heading 1",
    description: "Large section heading",
    icon: Heading1,
    keywords: ["h1", "title", "heading"],
    group: "Basic",
    hint: "#",
    run: (e, r) => chain(e, r).setHeading({ level: 1 }).run(),
  },
  {
    id: "h2",
    title: "Heading 2",
    description: "Medium section heading",
    icon: Heading2,
    keywords: ["h2", "subtitle", "heading"],
    group: "Basic",
    hint: "##",
    run: (e, r) => chain(e, r).setHeading({ level: 2 }).run(),
  },
  {
    id: "h3",
    title: "Heading 3",
    description: "Small section heading",
    icon: Heading3,
    keywords: ["h3", "heading"],
    group: "Basic",
    hint: "###",
    run: (e, r) => chain(e, r).setHeading({ level: 3 }).run(),
  },
  {
    id: "bullet",
    title: "Bulleted list",
    description: "Simple bulleted list",
    icon: List,
    keywords: ["ul", "bullet", "list", "unordered"],
    group: "Basic",
    hint: "-",
    run: (e, r) => chain(e, r).toggleBulletList().run(),
  },
  {
    id: "numbered",
    title: "Numbered list",
    description: "List with numbering",
    icon: ListOrdered,
    keywords: ["ol", "numbered", "ordered", "list"],
    group: "Basic",
    hint: "1.",
    run: (e, r) => chain(e, r).toggleOrderedList().run(),
  },
  {
    id: "todo",
    title: "To-do list",
    description: "Track tasks with checkboxes",
    icon: ListChecks,
    keywords: ["todo", "task", "checkbox", "check"],
    group: "Basic",
    hint: "[]",
    run: (e, r) => chain(e, r).toggleTaskList().run(),
  },
  {
    id: "toggle",
    title: "Toggle list",
    description: "Collapsible section",
    icon: ChevronRight,
    keywords: ["toggle", "collapse", "details", "accordion"],
    group: "Basic",
    run: (e, r) => chain(e, r).setDetails().run(),
  },
  {
    id: "quote",
    title: "Quote",
    description: "Capture a quotation",
    icon: Quote,
    keywords: ["quote", "blockquote", "citation"],
    group: "Basic",
    hint: ">",
    run: (e, r) => chain(e, r).toggleBlockquote().run(),
  },
  {
    id: "divider",
    title: "Divider",
    description: "Visual separator",
    icon: Minus,
    keywords: ["hr", "divider", "separator", "line"],
    group: "Basic",
    hint: "---",
    run: (e, r) => chain(e, r).setHorizontalRule().run(),
  },
  {
    id: "callout",
    title: "Callout",
    description: "Make a note stand out",
    icon: Megaphone,
    keywords: ["callout", "note", "info", "warning", "tip"],
    group: "Advanced",
    run: (e, r) => chain(e, r).setCallout().run(),
  },
  {
    id: "code",
    title: "Code block",
    description: "Code with syntax highlighting",
    icon: Code2,
    keywords: ["code", "snippet", "pre"],
    group: "Advanced",
    hint: "```",
    run: (e, r) => chain(e, r).toggleCodeBlock().run(),
  },
  {
    id: "table",
    title: "Table",
    description: "Simple rows and columns",
    icon: Table,
    keywords: ["table", "grid", "rows", "columns"],
    group: "Advanced",
    run: (e, r) => chain(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: "image",
    title: "Image",
    description: "Upload an image",
    icon: ImageIcon,
    keywords: ["image", "picture", "photo", "img"],
    group: "Media",
    run: (e, r) => {
      chain(e, r).run();
      void uploadAndInsert(e, "image");
    },
  },
  {
    id: "file",
    title: "File",
    description: "Upload an attachment",
    icon: Paperclip,
    keywords: ["file", "attachment", "upload", "pdf"],
    group: "Media",
    run: (e, r) => {
      chain(e, r).run();
      void uploadAndInsert(e, "file");
    },
  },
  {
    id: "bookmark",
    title: "Bookmark",
    description: "Save a link as a card",
    icon: Bookmark,
    keywords: ["bookmark", "link", "url", "embed"],
    group: "Media",
    run: (e, r) => chain(e, r).insertBookmark().run(),
  },
];

export function filterBlocks(query: string): BlockItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return BLOCK_ITEMS;
  return BLOCK_ITEMS.filter(
    (item) => item.title.toLowerCase().includes(q) || item.keywords.some((k) => k.startsWith(q)),
  );
}
