import { z } from 'zod';
import { BRIEF_MODE_VALUES } from '../../shared/caseConstants';

export const createTemplateSchema = z.object({
  title: z.string().optional(),
  content_md: z.string().optional(),
  category: z.string().optional(),
  brief_mode: z.enum(BRIEF_MODE_VALUES, { error: '請選擇書狀性質' }),
});

export const updateTemplateSchema = z.object({
  title: z.string().min(1, '範本標題為必填').optional(),
  content_md: z.string().optional(),
  brief_mode: z.enum(BRIEF_MODE_VALUES).optional(),
});
