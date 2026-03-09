import { z } from 'zod';
import { CLIENT_ROLES } from '../../shared/caseConstants';

export const createCaseSchema = z.object({
  title: z.string().min(1, '案件名稱為必填'),
  case_number: z.string().optional(),
  court: z.string().optional(),
  plaintiff: z.string().optional(),
  defendant: z.string().optional(),
  client_role: z.enum(CLIENT_ROLES).optional(),
  case_instructions: z.string().optional(),
  division: z.string().optional(),
});

export const updateCaseSchema = z.object({
  title: z.string().optional(),
  case_number: z.string().optional(),
  court: z.string().optional(),
  plaintiff: z.string().optional(),
  defendant: z.string().optional(),
  client_role: z.enum(CLIENT_ROLES).optional(),
  case_instructions: z.string().optional(),
  division: z.string().nullable().optional(),
  template_id: z.string().nullable().optional(),
});
