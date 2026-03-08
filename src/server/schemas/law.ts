import { z } from 'zod';

export const searchLawSchema = z.object({
  query: z.string().min(1, '搜尋關鍵字為必填'),
  limit: z.number().optional(),
  nature: z.string().optional(),
});

export const addLawRefsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        law_name: z.string(),
        article: z.string(),
        full_text: z.string(),
      }),
    )
    .min(1, '法條項目為必填'),
});
