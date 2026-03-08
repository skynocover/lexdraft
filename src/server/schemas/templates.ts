import { z } from 'zod';

export const createTemplateSchema = z.object({
  title: z.string().optional(),
  content_md: z.string().optional(),
  category: z.string().optional(),
});

export const updateTemplateSchema = z.object({
  title: z.string().min(1, '範本標題為必填').optional(),
  content_md: z.string().optional(),
});
