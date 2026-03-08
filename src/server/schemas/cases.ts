import { z } from 'zod';

export const createCaseSchema = z.object({
  title: z.string().min(1, '案件名稱為必填'),
  case_number: z.string().optional(),
  court: z.string().optional(),
  plaintiff: z.string().optional(),
  defendant: z.string().optional(),
  client_role: z.string().optional(),
  case_instructions: z.string().optional(),
});

export const updateCaseSchema = z.object({
  title: z.string().optional(),
  case_number: z.string().optional(),
  court: z.string().optional(),
  plaintiff: z.string().optional(),
  defendant: z.string().optional(),
  client_role: z.string().optional(),
  case_instructions: z.string().optional(),
  template_id: z.string().nullable().optional(),
});
