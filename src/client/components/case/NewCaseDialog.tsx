import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../../lib/api';
import { COURTS, SELECT_NONE } from '../../lib/caseConstants';
import type { Case } from '../../stores/useCaseStore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Input } from '../ui/input';
import { Button } from '../ui/button';

interface NewCaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const inputClass =
  'border-bd bg-bg-3 text-t1 placeholder:text-t3 focus-visible:border-ac focus-visible:ring-ac/50';

export const NewCaseDialog = ({ open, onOpenChange }: NewCaseDialogProps) => {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [clientRole, setClientRole] = useState('');
  const [plaintiff, setPlaintiff] = useState('');
  const [defendant, setDefendant] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [court, setCourt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleClose = () => {
    onOpenChange(false);
    setTitle('');
    setClientRole('');
    setPlaintiff('');
    setDefendant('');
    setCaseNumber('');
    setCourt('');
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('案件名稱為必填');
      return;
    }
    if (!clientRole) {
      setError('請選擇我方立場');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const created = await api.post<Case>('/cases', {
        title: title.trim(),
        client_role: clientRole,
        plaintiff: plaintiff.trim() || undefined,
        defendant: defendant.trim() || undefined,
        case_number: caseNumber.trim() || undefined,
        court: court || undefined,
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
      <DialogContent className="border-bd bg-bg-1 sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-t1">新建案件</DialogTitle>
            <DialogDescription className="text-t3">
              填寫基本資訊，其餘可稍後在案件資訊中補填。
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
                placeholder="例：王小明 v. 李大華 車禍損害賠償"
                className={inputClass}
                autoFocus
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-t2">
                當事人 <span className="text-rd">*</span>
              </label>
              <div className="flex gap-3">
                {[
                  { value: 'plaintiff', label: '原告方' },
                  { value: 'defendant', label: '被告方' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setClientRole(opt.value)}
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
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Input
                  value={plaintiff}
                  onChange={(e) => setPlaintiff(e.target.value)}
                  placeholder="原告名稱"
                  className={inputClass}
                />
                <Input
                  value={defendant}
                  onChange={(e) => setDefendant(e.target.value)}
                  placeholder="被告名稱"
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm text-t2">案號</label>
                <Input
                  value={caseNumber}
                  onChange={(e) => setCaseNumber(e.target.value)}
                  placeholder="114年度雄簡字第○○號"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-t2">法院</label>
                <Select
                  value={court || SELECT_NONE}
                  onValueChange={(v) => setCourt(v === SELECT_NONE ? '' : v)}
                >
                  <SelectTrigger className={inputClass}>
                    <SelectValue placeholder="請選擇" />
                  </SelectTrigger>
                  <SelectContent className="border-bd bg-bg-2">
                    <SelectItem value={SELECT_NONE} className="text-t3">
                      請選擇
                    </SelectItem>
                    <SelectSeparator />
                    {COURTS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
