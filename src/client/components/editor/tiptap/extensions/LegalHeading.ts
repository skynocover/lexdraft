import Heading from '@tiptap/extension-heading'

export const LegalHeading = Heading.extend({
  name: 'heading',

  addAttributes() {
    return {
      ...this.parent?.(),
      sectionName: { default: null },
      subsectionName: { default: null },
    }
  },
})
