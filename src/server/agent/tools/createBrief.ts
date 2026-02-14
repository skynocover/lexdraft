import { nanoid } from 'nanoid'
import { briefs } from '../../db/schema'
import type { ToolHandler } from './types'

export const handleCreateBrief: ToolHandler = async (args, caseId, _db, drizzle, ctx) => {
  const briefType = args.brief_type as string
  const title = args.title as string

  if (!briefType || !title) {
    return { result: 'Error: brief_type and title are required', success: false }
  }

  const briefId = nanoid()
  const now = new Date().toISOString()

  await drizzle.insert(briefs).values({
    id: briefId,
    case_id: caseId,
    brief_type: briefType,
    title,
    content_structured: JSON.stringify({ paragraphs: [] }),
    version: 1,
    created_at: now,
    updated_at: now,
  })

  if (ctx) {
    await ctx.sendSSE({
      type: 'brief_update',
      brief_id: briefId,
      action: 'create_brief',
      data: {
        id: briefId,
        case_id: caseId,
        brief_type: briefType,
        title,
        content_structured: { paragraphs: [] },
        version: 1,
        created_at: now,
        updated_at: now,
      },
    })
  }

  return {
    result: `已建立書狀「${title}」，brief_id: ${briefId}。請使用此 brief_id 搭配 write_brief_section 逐段撰寫內容。`,
    success: true,
  }
}
