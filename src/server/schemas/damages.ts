import { z } from 'zod';

export const createDamageSchema = z.object({
  category: z.string().min(1, '金額類別為必填'),
  description: z.string().optional(),
  amount: z.number({ error: '金額必須為數字' }),
  basis: z.string().optional(),
});

export const updateDamageSchema = z.object({
  category: z.string().optional(),
  description: z.string().optional(),
  amount: z.number().optional(),
  basis: z.string().optional(),
});
