// Autocorrect in the page editor: when a word ends, fixes it (src/lib/autocorrect.ts) and
// curls quotes as they're typed. Backspace right after a correction puts back what was typed.
// Never inside code blocks or inline code.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { correction, DEFAULT_AUTOCORRECT, smartQuote, type AutocorrectOptions } from "@/lib/autocorrect";

type Last = { from: number; to: number; original: string } | null;

const key = new PluginKey<Last>("skele-autocorrect");

function inCode(state: EditorState, pos: number) {
  const $pos = state.doc.resolve(pos);
  if ($pos.parent.type.spec.code) return true;
  const code = state.schema.marks.code;
  return !!code && (!!code.isInSet(state.storedMarks ?? $pos.marks()) || !!code.isInSet($pos.marks()));
}

export const Autocorrect = Extension.create<{ options: () => AutocorrectOptions }>({
  name: "autocorrect",

  addOptions() {
    return { options: () => DEFAULT_AUTOCORRECT };
  },

  addProseMirrorPlugins() {
    const get = () => this.options.options();
    return [
      new Plugin<Last>({
        key,
        state: {
          init: () => null,
          apply: (tr, last) => {
            const meta = tr.getMeta(key) as Last | undefined;
            if (meta !== undefined) return meta;
            return tr.docChanged || tr.selectionSet ? null : last;
          },
        },
        props: {
          handleTextInput(view, from, to, text) {
            const o = get();
            if (!o.enabled || text.length !== 1 || from !== to) return false;
            const { state } = view;
            if (inCode(state, from)) return false;
            const $from = state.doc.resolve(from);
            const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 60), $from.parentOffset, undefined, "￼");

            if (o.smartQuotes && (text === '"' || text === "'")) {
              view.dispatch(state.tr.insertText(smartQuote(before, text), from, to));
              return true;
            }
            const fix = correction(before, text, o);
            if (!fix) return false;
            const start = from - fix.length;
            // Only plain text: a word spanning a link or another inline node is left alone.
            if (state.doc.textBetween(start, from, undefined, "￼") !== before.slice(-fix.length)) return false;
            const original = before.slice(-fix.length);
            const tr = state.tr.insertText(fix.text + text, start, to);
            tr.setMeta(key, { from: start, to: start + fix.text.length + text.length, original });
            view.dispatch(tr);
            return true;
          },
          handleKeyDown(view, event) {
            if (event.key !== "Backspace" || event.ctrlKey || event.metaKey || event.altKey) return false;
            const last = key.getState(view.state);
            const sel = view.state.selection;
            if (!last || !sel.empty || sel.from !== last.to) return false;
            const tr = view.state.tr.insertText(last.original, last.from, last.to);
            tr.setMeta(key, null);
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});
