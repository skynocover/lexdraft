import Paragraph from '@tiptap/extension-paragraph'

export const LegalParagraph = Paragraph.extend({
  name: 'paragraph',

  addAttributes() {
    return {
      ...this.parent?.(),
      paragraphId: { default: null },
      disputeId: { default: null },
    }
  },
})
