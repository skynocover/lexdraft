import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { Damage } from '../../stores/useAnalysisStore';

export const DAMAGE_CATEGORIES = ['財產上損害', '非財產上損害'] as const;
export type DamageCategory = (typeof DAMAGE_CATEGORIES)[number];

interface DamageFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  damage: Damage | null;
  onSubmit: (data: {
    category: string;
    description: string;
    amount: number;
    basis: string;
  }) => void;
  loading?: boolean;
}

export const DamageFormDialog = ({
  open,
  onOpenChange,
  damage,
  onSubmit,
  loading,
}: DamageFormDialogProps) => {
  const [category, setCategory] = useState<string>(DAMAGE_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [basis, setBasis] = useState('');

  useEffect(() => {
    if (open) {
      const cat = damage?.category ?? DAMAGE_CATEGORIES[0];
      setCategory(DAMAGE_CATEGORIES.includes(cat as DamageCategory) ? cat : DAMAGE_CATEGORIES[0]);
      setDescription(damage?.description ?? '');
      setAmount(damage?.amount?.toString() ?? '');
      setBasis(damage?.basis ?? '');
    }
  }, [open, damage]);

  const isEdit = !!damage;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (!description.trim() || isNaN(parsedAmount)) return;

    onSubmit({
      category,
      description: description.trim(),
      amount: parsedAmount,
      basis: basis.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-bd bg-bg-1 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-t1">{isEdit ? '編輯金額項目' : '新增金額項目'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 項目名稱 + 金額 同一行 */}
          <div className="flex gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="dmg-desc" className="text-t2">
                項目名稱
              </Label>
              <Input
                id="dmg-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="例如：醫療費用"
                required
                className="border-bd bg-bg-2 text-t1"
              />
            </div>
            <div className="w-32 space-y-2">
              <Label htmlFor="dmg-amount" className="text-t2">
                金額 (NT$)
              </Label>
              <Input
                id="dmg-amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                required
                className="border-bd bg-bg-2 text-t1"
              />
            </div>
          </div>

          {/* 依據（多行） */}
          <div className="space-y-2">
            <Label htmlFor="dmg-basis" className="text-t2">
              依據
            </Label>
            <Textarea
              id="dmg-basis"
              value={basis}
              onChange={(e) => setBasis(e.target.value)}
              placeholder="法律依據或計算方式"
              rows={3}
              className="border-bd bg-bg-2 text-t1"
            />
          </div>

          {/* 分類（移到最下面） */}
          <div className="space-y-2">
            <Label htmlFor="dmg-category" className="text-t2">
              分類
            </Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="border-bd bg-bg-2 text-t1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-bd bg-bg-1">
                {DAMAGE_CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={loading || !description.trim() || !amount || isNaN(parseFloat(amount))}
            >
              {loading ? '儲存中...' : isEdit ? '更新' : '新增'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
