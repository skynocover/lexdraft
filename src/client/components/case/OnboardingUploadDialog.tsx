import { useCallback, useRef, useState } from 'react';
import { Upload, FileText, Check, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCaseStore, type CaseFile } from '../../stores/useCaseStore';
import { useUIStore } from '../../stores/useUIStore';
import { api } from '../../lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';

interface OnboardingUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
}

interface UploadItem {
  id: string;
  name: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

export const OnboardingUploadDialog = ({
  open,
  onOpenChange,
  caseId,
}: OnboardingUploadDialogProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [uploading, setUploading] = useState(false);

  const markStatus = (itemId: string, status: UploadItem['status'], error?: string) => {
    setUploads((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, status, error } : item)),
    );
  };

  const uploadFiles = useCallback(
    async (fileList: FileList) => {
      const allFiles = Array.from(fileList);
      const files = allFiles.filter(
        (f) => f.type === 'application/pdf' && f.size <= 20 * 1024 * 1024,
      );
      const rejected = allFiles.length - files.length;
      if (rejected > 0) {
        toast.warning(`${rejected} 個檔案不符合格式（僅支援 PDF，20MB 以內）`);
      }
      if (files.length === 0) return;

      setUploading(true);

      const newItems: UploadItem[] = files.map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        status: 'uploading' as const,
      }));
      setUploads((prev) => [...prev, ...newItems]);

      const uploadedFiles: CaseFile[] = [];

      for (const [idx, file] of files.entries()) {
        const itemId = newItems[idx].id;
        const formData = new FormData();
        formData.append('file', file);

        try {
          const newFile = await api.upload<CaseFile>(`/cases/${caseId}/files`, formData);
          uploadedFiles.push(newFile);
          markStatus(itemId, 'done');
        } catch {
          markStatus(itemId, 'error', '上傳失敗');
        }
      }

      if (uploadedFiles.length > 0) {
        const setFiles = useCaseStore.getState().setFiles;
        setFiles([...useCaseStore.getState().files, ...uploadedFiles]);
      }

      setUploading(false);
    },
    [caseId],
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    onOpenChange(false);
    setUploads([]);
    setDragOver(false);
  };

  const handleCloseAndGoToMaterials = () => {
    handleClose();
    useUIStore.getState().setSidebarTab('case-materials');
  };

  const doneCount = uploads.filter((u) => u.status === 'done').length;
  const hasDone = doneCount > 0;
  const allFinished = uploads.length > 0 && !uploading;
  const hasErrors = uploads.some((u) => u.status === 'error');

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="bg-bg-1 border-bd sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
        showCloseButton={false}
      >
        {hasDone && allFinished ? (
          /* 階段二：上傳完成後的銜接 */
          <>
            <DialogHeader>
              <DialogTitle className="text-t1">
                <Check size={18} className="mr-1.5 inline text-gn" />
                已上傳 {doneCount} 個檔案
              </DialogTitle>
              <DialogDescription className="text-t3">AI 正在處理文件中...</DialogDescription>
            </DialogHeader>

            {/* 顯示 error 檔案 */}
            {hasErrors && (
              <div className="max-h-28 space-y-1.5 overflow-y-auto">
                {uploads
                  .filter((u) => u.status === 'error')
                  .map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 rounded-md bg-bg-2 px-3 py-2"
                    >
                      <FileText size={14} className="shrink-0 text-t3" />
                      <span className="min-w-0 flex-1 truncate text-sm text-t1">{item.name}</span>
                      <AlertCircle size={14} className="shrink-0 text-rd" />
                    </div>
                  ))}
              </div>
            )}

            <p className="text-xs text-t3">
              你可以在左側對話框選擇要撰寫的書狀類型，或等文件處理完再操作。
            </p>

            <DialogFooter>
              <Button
                type="button"
                onClick={handleCloseAndGoToMaterials}
                className="bg-ac text-bg-0 hover:bg-ac/90"
              >
                {hasErrors ? '完成' : '開始使用'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          /* 階段一：上傳中 */
          <>
            <DialogHeader>
              <DialogTitle className="text-t1">上傳案件文件</DialogTitle>
              <DialogDescription asChild>
                <div className="text-t3">
                  <p>上傳對方書狀、證據或判決等文件。AI 會自動：</p>
                  <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-t3">
                    <li>摘要每份文件重點</li>
                    <li>歸納雙方爭點</li>
                    <li>生成書狀時引用原文</li>
                  </ul>
                </div>
              </DialogDescription>
            </DialogHeader>

            {/* Drop zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition ${
                dragOver ? 'border-ac bg-ac/5' : 'border-bd hover:border-t3 hover:bg-bg-2'
              }`}
            >
              <Upload size={32} className={`mb-3 ${dragOver ? 'text-ac' : 'text-t3'}`} />
              <p className="text-sm font-medium text-t1">拖拽或點擊上傳案件文件</p>
              <p className="mt-1 text-xs text-t3">支援 PDF 格式，單檔最大 20MB</p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />

            {/* Uploaded file list */}
            {uploads.length > 0 && (
              <div className="max-h-40 space-y-1.5 overflow-y-auto">
                {uploads.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 rounded-md bg-bg-2 px-3 py-2"
                  >
                    <FileText size={14} className="shrink-0 text-t3" />
                    <span className="min-w-0 flex-1 truncate text-sm text-t1">{item.name}</span>
                    {item.status === 'uploading' && (
                      <Loader2 size={14} className="shrink-0 animate-spin text-ac" />
                    )}
                    {item.status === 'done' && <Check size={14} className="shrink-0 text-gn" />}
                    {item.status === 'error' && (
                      <AlertCircle size={14} className="shrink-0 text-rd" />
                    )}
                  </div>
                ))}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={handleClose}
                disabled={uploading}
                className="text-t2 hover:text-t1"
              >
                稍後再說
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="border-bd text-t1 hover:bg-bg-2"
              >
                選擇檔案
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
