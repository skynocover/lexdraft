import { z } from 'zod';
import type { ZodType } from 'zod';

// ── Tool Argument Schemas ──
// 對齊 definitions.ts 的 properties 和 required

export const listFilesArgsSchema = z.object({});

export const readFileArgsSchema = z.object({
  file_id: z.string({ error: 'file_id 為必填' }),
});

export const writeBriefSectionArgsSchema = z.object({
  brief_id: z.string({ error: 'brief_id 為必填' }),
  paragraph_id: z.string().optional(),
  section: z.string({ error: 'section 為必填' }),
  subsection: z.string({ error: 'subsection 為必填' }),
  instruction: z.string({ error: 'instruction 為必填' }),
  relevant_file_ids: z.array(z.string(), {
    error: 'relevant_file_ids 必須為字串陣列',
  }),
  relevant_law_ids: z.array(z.string()).optional(),
  dispute_id: z.string().optional(),
});

export const createBriefArgsSchema = z.object({
  template_id: z.string({ error: 'template_id 為必填' }),
  title: z.string({ error: 'title 為必填' }),
});

export const analyzeDisputesArgsSchema = z.object({});

export const calculateDamagesArgsSchema = z.object({});

export const searchLawArgsSchema = z.object({
  query: z.string({ error: 'query 為必填' }),
  law_name: z.string().optional(),
  limit: z.number().optional(),
});

export const generateTimelineArgsSchema = z.object({});

export const writeFullBriefArgsSchema = z.object({
  template_id: z.string({ error: 'template_id 為必填' }),
  title: z.string({ error: 'title 為必填' }),
});

export const reviewBriefArgsSchema = z.object({});

/** tool name → Zod schema 映射 */
export const toolSchemaMap: Record<string, ZodType> = {
  list_files: listFilesArgsSchema,
  read_file: readFileArgsSchema,
  write_brief_section: writeBriefSectionArgsSchema,
  create_brief: createBriefArgsSchema,
  analyze_disputes: analyzeDisputesArgsSchema,
  calculate_damages: calculateDamagesArgsSchema,
  search_law: searchLawArgsSchema,
  generate_timeline: generateTimelineArgsSchema,
  write_full_brief: writeFullBriefArgsSchema,
  review_brief: reviewBriefArgsSchema,
};
