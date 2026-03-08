import { z } from 'zod';

export const createTimelineEventSchema = z.object({
  date: z.string().min(1, '日期為必填'),
  title: z.string().min(1, '標題為必填'),
  description: z.string().optional(),
  is_critical: z.boolean().optional(),
});

export const updateTimelineEventSchema = z.object({
  date: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  is_critical: z.boolean().optional(),
});
