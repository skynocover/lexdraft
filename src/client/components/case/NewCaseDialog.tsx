import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../../lib/api';
import type { Case } from '../../stores/useCaseStore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Button } from '../ui/button';

interface NewCaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const NewCaseDialog = ({ open, onOpenChange }: NewCaseDialogProps) => {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [clientRole, setClientRole] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleClose = () => {
    onOpenChange(false);
    setTitle('');
    setClientRole('');
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('案件名稱為必填');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const created = await api.post<Case>('/cases', {
        title: title.trim(),
        client_role: clientRole || undefined,
      });
      handleClose();
      navigate(`/cases/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立失敗');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-bg-1 border-bd sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-t1">新建案件</DialogTitle>
            <DialogDescription className="text-t3">
              輸入案件名稱即可快速建立，其他資訊可稍後補填。
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-t2">
                案件名稱 <span className="text-rd">*</span>
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例：艾凡尼公司 v. 朱立家"
                className="border-bd bg-bg-3 text-t1 placeholder:text-t3 focus-visible:border-ac focus-visible:ring-ac/50"
                autoFocus
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-t2">我方立場</label>
              <div className="flex gap-3">
                {[
                  { value: 'plaintiff', label: '原告方' },
                  { value: 'defendant', label: '被告方' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setClientRole((prev) => (prev === opt.value ? '' : opt.value))}
                    className={`flex-1 rounded border px-4 py-2 text-sm font-medium transition ${
                      clientRole === opt.value
                        ? 'border-ac bg-ac/15 text-ac'
                        : 'border-bd text-t3 hover:border-t3 hover:text-t1'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-rd">{error}</p>}
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              className="text-t2 hover:text-t1"
            >
              取消
            </Button>
            <Button type="submit" disabled={loading} className="bg-ac text-bg-0 hover:bg-ac/90">
              {loading ? '建立中...' : '建立案件'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
