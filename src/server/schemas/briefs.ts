import { z } from 'zod';

export const createBriefSchema = z.object({
  template_id: z.string().min(1, '範本 ID 為必填'),
  title: z.string().min(1, '書狀標題為必填'),
});

export const updateBriefSchema = z.object({
  title: z.string().optional(),
  content_structured: z.unknown().optional(),
  template_id: z.string().optional(),
});
