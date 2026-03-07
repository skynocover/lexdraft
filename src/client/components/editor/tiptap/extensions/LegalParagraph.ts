import Paragraph from '@tiptap/extension-paragraph';

export const LegalParagraph = Paragraph.extend({
  name: 'paragraph',

  addAttributes() {
    return {
      ...this.parent?.(),
      paragraphId: { default: null },
      disputeId: { default: null },
      preformattedSection: { default: false },
    };
  },

  renderHTML({ HTMLAttributes }) {
    const attrs: Record<string, string> = {};
    if (HTMLAttributes.paragraphId) {
      attrs['data-paragraph-id'] = HTMLAttributes.paragraphId;
    }
    if (HTMLAttributes.disputeId) {
      attrs['data-dispute-id'] = HTMLAttributes.disputeId;
    }
    const classes = [HTMLAttributes.class];
    if (HTMLAttributes.preformattedSection) {
      classes.push('legal-preformatted');
    }
    attrs.class = classes.filter(Boolean).join(' ');
    return ['p', attrs, 0];
  },
});
