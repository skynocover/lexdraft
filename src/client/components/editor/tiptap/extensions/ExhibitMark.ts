import { Mark, mergeAttributes } from '@tiptap/core';

export const ExhibitMark = Mark.create({
  name: 'exhibitMark',

  addAttributes() {
    return {
      citationId: { default: null },
      fileId: { default: null },
      quotedText: { default: '' },
      label: { default: '' },
      blockIndex: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-exhibit-mark]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        {
          'data-exhibit-mark': HTMLAttributes.citationId || '',
          'data-file-id': HTMLAttributes.fileId || '',
          'data-quoted-text': HTMLAttributes.quotedText || '',
          'data-label': HTMLAttributes.label || '',
          'data-block-index': HTMLAttributes.blockIndex ?? '',
          class: 'exhibit-mark',
        },
        HTMLAttributes,
      ),
      0,
    ];
  },
});
