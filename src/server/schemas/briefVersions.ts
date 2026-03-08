import { z } from 'zod';

export const createVersionSchema = z.object({
  label: z.string().min(1, '版本標籤為必填'),
  created_by: z.string().optional(),
});
