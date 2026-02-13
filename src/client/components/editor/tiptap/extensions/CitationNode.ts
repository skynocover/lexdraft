import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { CitationNodeView } from './CitationNodeView'

export const CitationNode = Node.create({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      citationId: { default: null },
      label: { default: '' },
      type: { default: 'law' },
      status: { default: 'confirmed' },
      quotedText: { default: '' },
      fileId: { default: null },
      index: { default: 0 },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-citation-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-citation-id': HTMLAttributes.citationId }, HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CitationNodeView, { as: 'span', className: '' })
  },
})
