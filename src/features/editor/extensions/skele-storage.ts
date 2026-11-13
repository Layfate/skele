import { Extension } from "@tiptap/core";

export type UploadResult = { url: string; name: string; size: number; mimeType: string };
export type Uploader = (file: File) => Promise<UploadResult | null>;
export type PageRef = { id: string; title: string; icon: string | null };

/** App callbacks that custom nodes, the slash menu and `[[` links can reach. */
export type SkeleHost = {
  upload: Uploader | null;
  searchPages: ((query: string) => Promise<PageRef[]>) | null;
  createPage: ((title: string) => Promise<PageRef>) | null;
  openPage: ((id: string) => void) | null;
  /** Resolves `skele-file:` references to displayable URLs. */
  resolveFile: ((ref: string) => Promise<string | null>) | null;
  /** Current title of a page (for renamed link targets). */
  pageTitle: ((id: string) => string | undefined) | null;
};

declare module "@tiptap/core" {
  interface Storage {
    skele: SkeleHost;
  }
}

const EMPTY: SkeleHost = { upload: null, searchPages: null, createPage: null, openPage: null, resolveFile: null, pageTitle: null };

export const SkeleStorageExtension = Extension.create<Partial<SkeleHost>, SkeleHost>({
  name: "skele",
  addOptions() {
    return {};
  },
  addStorage() {
    return { ...EMPTY, ...this.options };
  },
});

/** Opens a native file picker and resolves with the chosen file (or null). */
export function pickFile(accept?: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (accept) input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
