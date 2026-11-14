"use client";

import { memo, useState, type ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group/code my-3 overflow-hidden rounded-lg border bg-muted/50">
      <div className="flex h-8 items-center justify-between border-b bg-muted/60 px-3 text-xs text-muted-foreground">
        <span className="font-mono">{language || "text"}</span>
        <button
          type="button"
          onClick={async () => {
            if (await copyText(code)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed scrollbar-thin">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const components: Components = {
  p: (props) => <p className="my-2.5 leading-7 first:mt-0 last:mb-0" {...props} />,
  a: ({ href, ...props }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" className="font-medium text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand" {...props} />
  ),
  ul: (props) => <ul className="my-2.5 list-disc space-y-1 pl-6 marker:text-muted-foreground" {...props} />,
  ol: (props) => <ol className="my-2.5 list-decimal space-y-1 pl-6 marker:text-muted-foreground" {...props} />,
  li: (props) => <li className="leading-7 [&>ol]:my-1 [&>ul]:my-1" {...props} />,
  h1: (props) => <h1 className="mt-6 mb-3 text-xl font-semibold tracking-tight first:mt-0" {...props} />,
  h2: (props) => <h2 className="mt-5 mb-2.5 text-lg font-semibold tracking-tight first:mt-0" {...props} />,
  h3: (props) => <h3 className="mt-4 mb-2 text-base font-semibold first:mt-0" {...props} />,
  h4: (props) => <h4 className="mt-3 mb-1.5 font-semibold first:mt-0" {...props} />,
  blockquote: (props) => <blockquote className="my-3 border-l-2 border-brand/50 pl-4 text-muted-foreground" {...props} />,
  hr: () => <hr className="my-5 border-border" />,
  table: (props) => (
    <div className="my-3 overflow-x-auto rounded-lg border scrollbar-thin">
      <table className="w-full text-left text-sm" {...props} />
    </div>
  ),
  thead: (props) => <thead className="bg-muted/60" {...props} />,
  th: (props) => <th className="border-b px-3 py-2 font-medium" {...props} />,
  td: (props) => <td className="border-b px-3 py-2 align-top [tr:last-child_&]:border-b-0" {...props} />,
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children, ...props }: ComponentProps<"code">) => {
    const text = String(children ?? "");
    const language = /language-([\w+-]+)/.exec(className ?? "")?.[1];
    // Fenced blocks have a language class or span several lines; everything else is inline.
    if (language || text.includes("\n")) return <CodeBlock language={language ?? ""} code={text.replace(/\n$/, "")} />;
    return (
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.86em]" {...props}>
        {children}
      </code>
    );
  },
  input: (props) => <input {...props} disabled className="mr-1.5 align-middle accent-[var(--brand)]" />,
};

export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("min-w-0 text-[15px] break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
