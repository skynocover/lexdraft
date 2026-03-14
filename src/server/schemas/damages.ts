import { z } from 'zod';

export const createDamageSchema = z.object({
  description: z.string().min(1, '金額說明為必填'),
  amount: z.number({ error: '金額必須為數字' }),
  basis: z.string().optional(),
  dispute_id: z.string().nullable().optional(),
});

export const updateDamageSchema = z.object({
  description: z.string().optional(),
  amount: z.number().optional(),
  basis: z.string().optional(),
  dispute_id: z.string().nullable().optional(),
});
