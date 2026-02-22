import { useState } from 'react';
import { CircleDollarSign, Plus } from 'lucide-react';
import { Button } from '../ui/button';
import { useAnalysisStore, type Damage } from '../../stores/useAnalysisStore';
import { useChatStore } from '../../stores/useChatStore';
import { useCaseStore } from '../../stores/useCaseStore';
import { DamageGroup } from './DamageGroup';
import { DamageFormDialog } from './DamageFormDialog';
import { ConfirmDialog } from '../layout/sidebar/ConfirmDialog';
import { formatAmount } from '../../lib/textUtils';

export function DamagesTab() {
  const damages = useAnalysisStore((s) => s.damages);
  const addDamage = useAnalysisStore((s) => s.addDamage);
  const updateDamage = useAnalysisStore((s) => s.updateDamage);
  const removeDamage = useAnalysisStore((s) => s.removeDamage);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const currentCase = useCaseStore((s) => s.currentCase);

  const [formOpen, setFormOpen] = useState(false);
  const [editingDamage, setEditingDamage] = useState<Damage | null>(null);
  const [deletingDamage, setDeletingDamage] = useState<Damage | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGenerate = () => {
    if (!currentCase || isStreaming) return;
    sendMessage(currentCase.id, '請幫我計算案件請求金額');
  };

  const handleAdd = () => {
    setEditingDamage(null);
    setFormOpen(true);
  };

  const handleEdit = (damage: Damage) => {
    setEditingDamage(damage);
    setFormOpen(true);
  };

  const handleDelete = (damage: Damage) => {
    setDeletingDamage(damage);
  };

  const handleSubmit = async (data: {
    category: string;
    description: string;
    amount: number;
    basis: string;
  }) => {
    if (!currentCase) return;
    setLoading(true);
    try {
      if (editingDamage) {
        await updateDamage(editingDamage.id, data);
      } else {
        await addDamage(currentCase.id, data);
      }
      setFormOpen(false);
    } catch (err) {
      console.error('Damage save error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingDamage) return;
    try {
      await removeDamage(deletingDamage.id);
    } catch (err) {
      console.error('Damage delete error:', err);
    } finally {
      setDeletingDamage(null);
    }
  };

  // Group by fixed categories
  const grouped = damages.reduce<Record<string, Damage[]>>(
    (acc, d) => {
      const key = d.category === '非財產上損害' ? '非財產上損害' : '財產上損害';
      acc[key].push(d);
      return acc;
    },
    { 財產上損害: [], 非財產上損害: [] },
  );

  const totalAmount = damages.reduce((sum, d) => sum + d.amount, 0);

  return (
    <>
      {damages.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-4">
          <CircleDollarSign className="h-8 w-8 text-t3" />
          <p className="text-center text-xs text-t3">尚未計算金額</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleAdd}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              手動新增
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!currentCase || isStreaming}
              onClick={handleGenerate}
            >
              {isStreaming ? 'AI 分析中...' : 'AI 自動計算'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="mb-2 flex items-center justify-end">
            <button
              onClick={handleAdd}
              className="rounded p-1 text-t3 transition hover:bg-bg-h hover:text-t1"
              title="新增金額項目"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto">
            {Object.entries(grouped)
              .filter(([, items]) => items.length > 0)
              .map(([category, items]) => (
                <DamageGroup
                  key={category}
                  category={category}
                  items={items}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
          </div>

          {/* Total bar */}
          <div className="mt-2 shrink-0 rounded border border-ac/30 bg-ac/10 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ac">請求總額</span>
              <span className="text-sm font-bold text-ac">{formatAmount(totalAmount)}</span>
            </div>
          </div>
        </div>
      )}

      <DamageFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        damage={editingDamage}
        onSubmit={handleSubmit}
        loading={loading}
      />

      {deletingDamage && (
        <ConfirmDialog
          message={`確定刪除金額項目「${deletingDamage.description || deletingDamage.category}」？`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeletingDamage(null)}
        />
      )}
    </>
  );
}
