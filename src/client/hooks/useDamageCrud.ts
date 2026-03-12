import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useAnalysisStore, type Damage } from '../stores/useAnalysisStore';

interface DamageFormData {
  category: string;
  description: string;
  amount: number;
  basis: string;
}

export const useDamageCrud = (caseId: string | undefined) => {
  const addDamage = useAnalysisStore((s) => s.addDamage);
  const updateDamage = useAnalysisStore((s) => s.updateDamage);
  const removeDamage = useAnalysisStore((s) => s.removeDamage);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Damage | null>(null);
  const [deleting, setDeleting] = useState<Damage | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingDisputeId, setPendingDisputeId] = useState<string | null>(null);

  const openAdd = useCallback((disputeId?: string | null) => {
    setPendingDisputeId(typeof disputeId === 'string' ? disputeId : null);
    setEditing(null);
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((d: Damage) => {
    setPendingDisputeId(null);
    setEditing(d);
    setFormOpen(true);
  }, []);

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setPendingDisputeId(null);
  }, []);

  const stageDelete = useCallback((d: Damage) => setDeleting(d), []);
  const clearDelete = useCallback(() => setDeleting(null), []);

  const handleSubmit = useCallback(
    async (data: DamageFormData) => {
      if (!caseId) return;
      setLoading(true);
      try {
        if (editing) {
          await updateDamage(editing.id, data);
        } else {
          await addDamage(caseId, { ...data, dispute_id: pendingDisputeId });
        }
        setFormOpen(false);
        setEditing(null);
      } catch {
        toast.error(editing ? '更新金額失敗' : '新增金額失敗');
      } finally {
        setLoading(false);
      }
    },
    [caseId, editing, pendingDisputeId, addDamage, updateDamage],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleting) return;
    try {
      await removeDamage(deleting.id);
      toast.success('金額項目已刪除');
    } catch {
      toast.error('刪除金額失敗');
    } finally {
      setDeleting(null);
    }
  }, [deleting, removeDamage]);

  return {
    formOpen,
    closeForm,
    editing,
    deleting,
    stageDelete,
    clearDelete,
    loading,
    openAdd,
    openEdit,
    handleSubmit,
    handleConfirmDelete,
  };
};
