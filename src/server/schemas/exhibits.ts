import { z } from 'zod';

export const createExhibitSchema = z.object({
  file_id: z.string().min(1, '檔案 ID 為必填'),
  prefix: z.string().optional(),
  doc_type: z.string().optional(),
});

export const updateExhibitSchema = z.object({
  prefix: z.string().optional(),
  number: z.number().optional(),
  doc_type: z.string().optional(),
  description: z.string().optional(),
});

export const reorderExhibitsSchema = z.object({
  prefix: z.string().min(1, '證物前綴為必填'),
  order: z.array(z.string()).min(1, '排序陣列為必填'),
});
