import { eq } from 'drizzle-orm';
import { files } from '../../db/schema';
import { toolError, toolSuccess } from '../toolHelpers';
import type { ToolHandler } from './types';

export const handleReadFile: ToolHandler = async (args, _caseId, _db, drizzle) => {
  const fileId = args.file_id as string;
  if (!fileId) {
    return toolError('file_id 為必填');
  }

  const rows = await drizzle
    .select({
      id: files.id,
      filename: files.filename,
      full_text: files.full_text,
      category: files.category,
    })
    .from(files)
    .where(eq(files.id, fileId));

  if (!rows.length) {
    return toolError(`找不到檔案（id: ${fileId}）`);
  }

  const file = rows[0];
  const text = file.full_text || '（無文字內容）';
  const truncated =
    text.length > 15000 ? text.slice(0, 15000) + '\n\n... [截斷，共 ' + text.length + ' 字]' : text;

  return toolSuccess(`檔案：${file.filename}\n分類：${file.category}\n\n全文內容：\n${truncated}`);
};
