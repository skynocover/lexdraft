import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useCaseStore, type CaseFile } from '../stores/useCaseStore';
import { api } from '../lib/api';

export const useFileUpload = () => {
  const currentCase = useCaseStore((s) => s.currentCase);
  const setFiles = useCaseStore((s) => s.setFiles);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || !currentCase) return;

    setUploading(true);
    const uploaded: CaseFile[] = [];
    for (const file of Array.from(fileList)) {
      if (file.type !== 'application/pdf') continue;
      if (file.size > 20 * 1024 * 1024) continue;

      const formData = new FormData();
      formData.append('file', file);
      try {
        const newFile = await api.upload<CaseFile>(`/cases/${currentCase.id}/files`, formData);
        uploaded.push(newFile);
      } catch (err) {
        console.error('Upload failed:', err);
        toast.error(`上傳「${file.name}」失敗`);
      }
    }
    if (uploaded.length > 0) {
      setFiles([...useCaseStore.getState().files, ...uploaded]);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const triggerFileSelect = () => fileInputRef.current?.click();

  return { fileInputRef, uploading, handleUpload, triggerFileSelect };
};
