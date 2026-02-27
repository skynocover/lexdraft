import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

const PLACEHOLDER_RE = /【待填[：:].*?】/g;

const buildDecorations = (doc: ProseMirrorNode): DecorationSet => {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    PLACEHOLDER_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PLACEHOLDER_RE.exec(node.text)) !== null) {
      decorations.push(
        Decoration.inline(pos + match.index, pos + match.index + match[0].length, {
          class: 'placeholder-fill',
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
};

export const PlaceholderHighlight = Extension.create({
  name: 'placeholderHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('placeholderHighlight'),
        state: {
          init(_, { doc }) {
            return buildDecorations(doc);
          },
          apply(tr, oldSet) {
            // Full rebuild on every doc change. Acceptable for typical legal document
            // sizes (< 10k chars). For very large docs, consider incremental update
            // using tr.mapping to only rebuild affected ranges.
            return tr.docChanged ? buildDecorations(tr.doc) : oldSet;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state) as DecorationSet;
          },
        },
      }),
    ];
  },
});
