import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../ui/dialog';
import { RadioGroup, RadioGroupItem } from '../../ui/radio-group';
import { Label } from '../../ui/label';
import { BRIEF_MODE_OPTIONS, type BriefModeValue } from '../../../../shared/caseConstants';

interface NewTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (title: string, briefMode: BriefModeValue) => void;
}

export const NewTemplateDialog = ({ open, onOpenChange, onCreate }: NewTemplateDialogProps) => {
  const [title, setTitle] = useState('');
  const [briefMode, setBriefMode] = useState<BriefModeValue | null>(null);

  const canCreate = title.trim().length > 0 && briefMode !== null;

  const handleCreate = () => {
    if (!canCreate) return;
    onCreate(title.trim(), briefMode!);
    onOpenChange(false);
  };

  const selectedOption = BRIEF_MODE_OPTIONS.find((o) => o.value === briefMode);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setTitle('');
      setBriefMode(null);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-bd bg-bg-1 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-t1">新增自訂範本</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Template name */}
          <div>
            <Label className="mb-1.5 block text-xs text-t3">範本名稱</Label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例：民事反訴狀"
              className="w-full rounded border border-bd bg-bg-3 px-2.5 py-1.5 text-xs text-t1 outline-none placeholder:text-t3 focus:border-ac"
              autoFocus
            />
          </div>

          {/* Brief mode radio group */}
          <div>
            <Label className="mb-1.5 block text-xs text-t3">書狀性質</Label>
            <RadioGroup
              value={briefMode ?? ''}
              onValueChange={(v) => setBriefMode(v as BriefModeValue)}
              className="flex flex-col gap-1"
            >
              {BRIEF_MODE_OPTIONS.map((opt) => (
                <Label
                  key={opt.value}
                  htmlFor={`bm-${opt.value}`}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-t2 transition hover:bg-bg-3"
                >
                  <RadioGroupItem value={opt.value} id={`bm-${opt.value}`} />
                  <span>
                    {opt.label}
                    <span className="ml-1 text-t3">（{opt.example}）</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>

            {/* Description of selected mode */}
            {selectedOption && (
              <p className="mt-2 rounded bg-bg-3 px-2.5 py-1.5 text-[11px] text-t3">
                {selectedOption.description}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded px-3 py-1.5 text-xs text-t3 transition hover:bg-bg-3 hover:text-t1"
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate}
            className="rounded bg-ac px-3 py-1.5 text-xs text-white transition hover:bg-ac/90 disabled:opacity-40"
          >
            建立
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
