import { z } from 'zod';

export const sendMessageSchema = z.object({
  message: z.string().min(1, '訊息為必填'),
  briefContext: z
    .object({
      brief_id: z.string(),
      title: z.string(),
      paragraphs: z.array(
        z.object({
          id: z.string(),
          section: z.string(),
          subsection: z.string(),
          content_preview: z.string().optional(),
        }),
      ),
    })
    .optional(),
});
