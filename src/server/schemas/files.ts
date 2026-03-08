import { z } from 'zod';

export const updateFileSchema = z.object({
  category: z.string().optional(),
  doc_date: z.string().optional(),
});
