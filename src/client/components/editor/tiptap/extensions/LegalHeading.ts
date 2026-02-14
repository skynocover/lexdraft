import Heading from "@tiptap/extension-heading";

export const LegalHeading = Heading.extend({
  name: "heading",

  addAttributes() {
    return {
      ...this.parent?.(),
      sectionName: { default: null },
      subsectionName: { default: null },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const level = HTMLAttributes.level || 2;
    const attrs: Record<string, string> = {};
    if (HTMLAttributes.sectionName) {
      attrs["data-section-name"] = HTMLAttributes.sectionName;
    }
    if (HTMLAttributes.subsectionName) {
      attrs["data-subsection-name"] = HTMLAttributes.subsectionName;
    }
    if (HTMLAttributes.class) {
      attrs.class = HTMLAttributes.class;
    }
    return [`h${level}`, attrs, 0];
  },
});
