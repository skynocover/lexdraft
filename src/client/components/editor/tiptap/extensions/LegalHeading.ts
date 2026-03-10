import Heading from '@tiptap/extension-heading';

export const LegalHeading = Heading.extend({
  name: 'heading',

  addAttributes() {
    return {
      ...this.parent?.(),
      sectionName: { default: null },
      subsectionName: { default: null },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const level = node.attrs.level || 2;
    const attrs: Record<string, string> = {};
    if (node.attrs.sectionName) {
      attrs['data-section-name'] = node.attrs.sectionName;
    }
    if (node.attrs.subsectionName) {
      attrs['data-subsection-name'] = node.attrs.subsectionName;
    }
    if (HTMLAttributes.class) {
      attrs.class = HTMLAttributes.class;
    }
    return [`h${level}`, attrs, 0];
  },
});
