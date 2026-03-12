import { useState, useEffect, useRef, type FC } from 'react';
import { ChevronRight, Pencil, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useAnalysisStore, type Dispute, type Damage } from '../../stores/useAnalysisStore';
import { useTabStore } from '../../stores/useTabStore';
import { cleanText, formatAmount } from '../../lib/textUtils';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { InlineDamageItem } from './InlineDamageItem';

// ── DisputeCard ──

export interface DisputeCardProps {
  dispute: Dispute;
  caseId: string;
  fileByName: Map<string, { id: string; filename: string }>;
  damages: Damage[];
  damageTotal: number;
  onAddDamage: (disputeId?: string | null) => void;
  onEditDamage: (damage: Damage) => void;
  onDeleteDamage: (damage: Damage) => void;
}

export const DisputeCard: FC<DisputeCardProps> = ({
  dispute,
  caseId,
  fileByName,
  damages,
  damageTotal,
  onAddDamage,
  onEditDamage,
  onDeleteDamage,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const updateDispute = useAnalysisStore((s) => s.updateDispute);
  const removeDispute = useAnalysisStore((s) => s.removeDispute);

  const evidenceCount = dispute.evidence?.length ?? 0;
  const lawRefCount = dispute.law_refs?.length ?? 0;

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditTitle(dispute.title || '');
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const trimmed = editTitle.trim();
      if (!trimmed || !caseId) {
        setEditing(false);
        return;
      }
      try {
        await updateDispute(caseId, dispute.id, { title: trimmed });
      } catch {
        toast.error('更新爭點標題失敗');
      }
      setEditing(false);
    } finally {
      savingRef.current = false;
    }
  };

  const handleCancelEdit = () => {
    savingRef.current = true;
    setEditing(false);
    // Reset after microtask so onBlur's handleSaveEdit sees the guard
    queueMicrotask(() => {
      savingRef.current = false;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(true);
  };

  const handleConfirmDelete = async () => {
    if (!caseId) return;
    try {
      await removeDispute(caseId, dispute.id);
      toast.success('爭點已刪除');
    } catch {
      toast.error('刪除爭點失敗');
    } finally {
      setConfirmDelete(false);
    }
  };

  // Build header badge text
  const badgeParts: string[] = [];
  if (evidenceCount > 0) badgeParts.push(`證據 ${evidenceCount}`);
  if (lawRefCount > 0) badgeParts.push(`法條 ${lawRefCount}`);

  return (
    <div className="group rounded border border-bd bg-bg-2">
      {/* Header */}
      <div className="px-3 py-2.5">
        <button
          onClick={() => !editing && setExpanded(!expanded)}
          className="flex w-full items-center gap-2 text-left transition"
        >
          <span className="shrink-0 text-xs font-medium text-t2">爭點 {dispute.number}</span>
          {/* Amount badge (always visible when has damages) */}
          {damageTotal > 0 && (
            <span className="shrink-0 rounded-full bg-ac/10 px-1.5 py-0.5 text-[10px] font-medium text-ac">
              {formatAmount(damageTotal)}
            </span>
          )}
          <span className="flex-1" />
          <span className="grid shrink-0 [&>*]:col-start-1 [&>*]:row-start-1">
            {!editing && (
              <span className="pointer-events-none flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                <button
                  type="button"
                  onClick={handleStartEdit}
                  className="rounded p-1 text-t3 transition hover:bg-bg-h hover:text-t1"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  className="rounded p-1 text-t3 transition hover:bg-rd/10 hover:text-rd"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
            {badgeParts.length > 0 && (
              <span className="flex items-center text-xs text-t3 opacity-100 transition-opacity group-hover:opacity-0">
                {badgeParts.join(' · ')}
              </span>
            )}
          </span>
          <ChevronRight
            size={14}
            className={`shrink-0 text-t3 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
          />
        </button>
        {editing ? (
          <input
            ref={inputRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSaveEdit}
            className="mt-1 w-full rounded border border-ac/50 bg-bg-1 px-2 py-1 text-sm font-medium text-t1 outline-none focus:border-ac"
          />
        ) : (
          <p
            onClick={() => setExpanded(!expanded)}
            className="mt-1 w-full cursor-pointer truncate text-left text-sm font-medium text-t1"
          >
            {cleanText(dispute.title || '未命名爭點')}
          </p>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="space-y-3 border-t border-bd px-3 py-2.5">
          {/* 我方論證 */}
          {dispute.our_position && (
            <div>
              <p className="mb-1 text-xs font-medium text-t3">我方論證</p>
              <div className="border-l-2 border-l-ac pl-2.5">
                <p className="text-sm leading-relaxed text-t1">{dispute.our_position}</p>
              </div>
              {/* 證據 + 法條 tags 歸在我方論證下 */}
              {((dispute.evidence && dispute.evidence.length > 0) ||
                (dispute.law_refs && dispute.law_refs.length > 0)) && (
                <div className="mt-1.5 flex flex-wrap gap-1 pl-2.5">
                  {dispute.evidence?.map((e, i) => {
                    const file = fileByName.get(e);
                    const label = cleanText(e).replace(/\.\w+$/, '');
                    return file ? (
                      <button
                        key={`ev-${i}`}
                        onClick={() => useTabStore.getState().openFileTab(file.id, file.filename)}
                        className="rounded bg-bg-3 px-1.5 py-0.5 text-xs text-t2 transition hover:bg-bg-h hover:text-t1"
                      >
                        {label}
                      </button>
                    ) : (
                      <span
                        key={`ev-${i}`}
                        className="rounded bg-bg-3 px-1.5 py-0.5 text-xs text-t2"
                      >
                        {label}
                      </span>
                    );
                  })}
                  {dispute.law_refs?.map((l, i) => (
                    <button
                      key={`law-${i}`}
                      onClick={() => useTabStore.getState().openLawSearchTab(cleanText(l), true)}
                      className="rounded bg-cy/10 px-1.5 py-0.5 text-xs text-cy transition hover:bg-cy/20"
                    >
                      {cleanText(l)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 對方論證 */}
          {dispute.their_position && (
            <div>
              <p className="mb-1 text-xs font-medium text-t3">對方論證</p>
              <div className="border-l-2 border-l-or pl-2.5">
                <p className="text-sm leading-relaxed text-t1">{dispute.their_position}</p>
              </div>
            </div>
          )}

          {/* 請求金額 */}
          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <p className="text-xs font-medium text-t3">請求金額</p>
              {damageTotal > 0 && (
                <span className="text-xs text-ac">{formatAmount(damageTotal)}</span>
              )}
              <span className="flex-1" />
              <button
                onClick={() => onAddDamage(dispute.id)}
                className="rounded p-0.5 text-t3 transition hover:bg-bg-h hover:text-t1"
                title="新增金額"
              >
                <Plus size={14} />
              </button>
            </div>
            {damages.length > 0 ? (
              <div className="space-y-1">
                {damages.map((d) => (
                  <InlineDamageItem
                    key={d.id}
                    damage={d}
                    onEdit={onEditDamage}
                    onDelete={onDeleteDamage}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-t3">尚無金額項目</p>
            )}
          </div>
        </div>
      )}

      {/* Dispute delete confirm */}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        description={`確定刪除「${cleanText(dispute.title || '未命名爭點')}」？相關主張也會一併刪除。`}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};
