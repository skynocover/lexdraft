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

  renderHTML({ HTMLAttributes }) {
    const attrs: Record<string, string> = {}
    if (HTMLAttributes.paragraphId) {
      attrs['data-paragraph-id'] = HTMLAttributes.paragraphId
    }
    if (HTMLAttributes.disputeId) {
      attrs['data-dispute-id'] = HTMLAttributes.disputeId
    }
    return ['p', { ...attrs, class: HTMLAttributes.class }, 0]
  },
})
