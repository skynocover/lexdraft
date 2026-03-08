import { z } from 'zod';

export const inlineAISchema = z.object({
  text: z.string().min(1, '轉換文字為必填'),
  operation: z.string().min(1, '操作類型為必填'),
});
