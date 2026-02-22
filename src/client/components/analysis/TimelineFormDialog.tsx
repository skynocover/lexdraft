import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';
import { Textarea } from '../ui/textarea';
import { Button } from '../ui/button';
import type { TimelineEvent } from '../../stores/useAnalysisStore';

interface TimelineFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: TimelineEvent | null;
  onSubmit: (data: Omit<TimelineEvent, 'id'>) => void;
  loading?: boolean;
}

export const TimelineFormDialog = ({
  open,
  onOpenChange,
  event,
  onSubmit,
  loading,
}: TimelineFormDialogProps) => {
  const [date, setDate] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isCritical, setIsCritical] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(event?.date ?? '');
      setTitle(event?.title ?? '');
      setDescription(event?.description ?? '');
      setIsCritical(event?.is_critical ?? false);
    }
  }, [open, event]);

  const isEdit = !!event;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date.trim() || !title.trim()) return;
    onSubmit({
      date: date.trim(),
      title: title.trim(),
      description: description.trim(),
      is_critical: isCritical,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-bd bg-bg-1 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-t1">{isEdit ? '編輯事件' : '新增事件'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tl-title" className="text-t2">
              標題
            </Label>
            <Input
              id="tl-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="事件標題"
              required
              className="border-bd bg-bg-2 text-t1"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tl-date" className="text-t2">
              日期
            </Label>
            <Input
              id="tl-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="border-bd bg-bg-2 text-t1"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tl-desc" className="text-t2">
              描述
            </Label>
            <Textarea
              id="tl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="事件詳細描述"
              rows={3}
              className="border-bd bg-bg-2 text-t1"
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="tl-critical"
              checked={isCritical}
              onCheckedChange={(checked) => setIsCritical(checked === true)}
            />
            <Label htmlFor="tl-critical" className="cursor-pointer text-t2">
              關鍵事件
            </Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" size="sm" disabled={loading || !date.trim() || !title.trim()}>
              {loading ? '儲存中...' : isEdit ? '更新' : '新增'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
