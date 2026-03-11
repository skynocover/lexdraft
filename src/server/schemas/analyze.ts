import { z } from 'zod';
import { ANALYSIS_TYPES } from '../../shared/types';

export const analyzeSchema = z.object({
  type: z.enum(ANALYSIS_TYPES, {
    error: '分析類型必須為 disputes、damages 或 timeline',
  }),
});
