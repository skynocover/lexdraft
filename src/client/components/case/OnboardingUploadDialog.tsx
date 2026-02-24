import { useCallback, useRef, useState } from 'react';
import { Upload, FileText, Check, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCaseStore, type CaseFile } from '../../stores/useCaseStore';
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

  const hasDone = uploads.some((u) => u.status === 'done');

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="bg-bg-1 border-bd sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="text-t1">上傳案件文件</DialogTitle>
          <DialogDescription className="text-t3">
            上傳相關文件讓 AI 助理能更好地協助你撰寫書狀。
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
              <div key={item.id} className="flex items-center gap-2 rounded-md bg-bg-2 px-3 py-2">
                <FileText size={14} className="shrink-0 text-t3" />
                <span className="min-w-0 flex-1 truncate text-sm text-t1">{item.name}</span>
                {item.status === 'uploading' && (
                  <Loader2 size={14} className="shrink-0 animate-spin text-ac" />
                )}
                {item.status === 'done' && <Check size={14} className="shrink-0 text-gn" />}
                {item.status === 'error' && <AlertCircle size={14} className="shrink-0 text-rd" />}
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
          {hasDone && !uploading ? (
            <Button type="button" onClick={handleClose} className="bg-ac text-bg-0 hover:bg-ac/90">
              完成
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="border-bd text-t1 hover:bg-bg-2"
            >
              選擇檔案
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
