import { useState, useEffect, useRef, useMemo, type FC } from 'react';
import { ChevronRight, Pencil, Trash2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAnalysisStore, type Dispute } from '../../stores/useAnalysisStore';
import { useCaseStore } from '../../stores/useCaseStore';
import { useTabStore } from '../../stores/useTabStore';
import { cleanText } from '../../lib/textUtils';
import { FactList } from './FactList';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { ReanalyzeButton } from './ReanalyzeButton';
import { EmptyAnalyzeButton } from './EmptyAnalyzeButton';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';

export const DisputesTab = () => {
  const disputes = useAnalysisStore((s) => s.disputes);
  const files = useCaseStore((s) => s.files);
  const fileByName = useMemo(() => new Map(files.map((f) => [f.filename, f])), [files]);

  if (disputes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4">
        <Search className="h-8 w-8 text-t3" />
        <p className="text-center text-xs text-t3">尚未分析爭點</p>
        <EmptyAnalyzeButton type="disputes" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center text-xs text-t3">
        <span>{disputes.length} 個爭點</span>
        <span className="flex-1" />
        <ReanalyzeButton type="disputes" hasData={disputes.length > 0} />
      </div>

      {disputes.map((d) => (
        <DisputeCard key={d.id} dispute={d} fileByName={fileByName} />
      ))}
    </div>
  );
};

interface DisputeCardProps {
  dispute: Dispute;
  fileByName: Map<string, { id: string; filename: string }>;
}

const DisputeCard: FC<DisputeCardProps> = ({ dispute, fileByName }) => {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const updateDispute = useAnalysisStore((s) => s.updateDispute);
  const removeDispute = useAnalysisStore((s) => s.removeDispute);
  const currentCase = useCaseStore((s) => s.currentCase);
  const openFileTab = useTabStore((s) => s.openFileTab);
  const openLawSearchTab = useTabStore((s) => s.openLawSearchTab);

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
    const trimmed = editTitle.trim();
    if (!trimmed || !currentCase) {
      setEditing(false);
      savingRef.current = false;
      return;
    }
    try {
      await updateDispute(currentCase.id, dispute.id, { title: trimmed });
    } catch {
      toast.error('更新爭點標題失敗');
    }
    setEditing(false);
    savingRef.current = false;
  };

  const handleCancelEdit = () => {
    setEditing(false);
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
    if (!currentCase) return;
    try {
      await removeDispute(currentCase.id, dispute.id);
      toast.success('爭點已刪除');
    } catch {
      toast.error('刪除爭點失敗');
    } finally {
      setConfirmDelete(false);
    }
  };

  return (
    <div
      className="rounded border border-bd bg-bg-2"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="px-3 py-2.5">
        <button
          onClick={() => !editing && setExpanded(!expanded)}
          className="flex w-full items-center gap-2 text-left transition"
        >
          <span className="shrink-0 text-xs font-medium text-t2">爭點 {dispute.number}</span>
          <span className="flex-1" />
          <span className="grid shrink-0 [&>*]:col-start-1 [&>*]:row-start-1">
            {!editing && (
              <span
                className={`flex items-center justify-end gap-1 transition-opacity ${hovered ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
              >
                <span
                  role="button"
                  onClick={handleStartEdit}
                  className="rounded p-1 text-t3 transition hover:bg-bg-h hover:text-t1"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </span>
                <span
                  role="button"
                  onClick={handleDeleteClick}
                  className="rounded p-1 text-t3 transition hover:bg-rd/10 hover:text-rd"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </span>
              </span>
            )}
            {(evidenceCount > 0 || lawRefCount > 0) && (
              <span
                className={`flex items-center text-xs text-t3 transition-opacity ${hovered && !editing ? 'opacity-0' : 'opacity-100'}`}
              >
                {[
                  evidenceCount > 0 ? `證據 ${evidenceCount}` : null,
                  lawRefCount > 0 ? `法條 ${lawRefCount}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
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
          <button onClick={() => setExpanded(!expanded)} className="mt-1 w-full text-left">
            <p className="truncate text-sm font-medium text-t1">
              {cleanText(dispute.title || '未命名爭點')}
            </p>
          </button>
        )}
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-bd px-3 py-2.5">
          {/* 雙方立場 */}
          {(dispute.our_position || dispute.their_position) && (
            <div className="space-y-1.5">
              {dispute.our_position && (
                <div className="border-l-2 border-l-ac pl-2.5">
                  <span className="text-xs font-medium text-t3">我方立場</span>
                  <p className="text-sm leading-relaxed text-t1">{dispute.our_position}</p>
                </div>
              )}
              {dispute.their_position && (
                <div className="border-l-2 border-l-or pl-2.5">
                  <span className="text-xs font-medium text-t3">對方立場</span>
                  <p className="text-sm leading-relaxed text-t1">{dispute.their_position}</p>
                </div>
              )}
            </div>
          )}

          {/* 證據 + 法條合併 tag 列 */}
          {((dispute.evidence && dispute.evidence.length > 0) ||
            (dispute.law_refs && dispute.law_refs.length > 0)) && (
            <div className="flex flex-wrap gap-1">
              {dispute.evidence?.map((e, i) => {
                const file = fileByName.get(e);
                const label = cleanText(e).replace(/\.\w+$/, '');
                return file ? (
                  <button
                    key={`ev-${i}`}
                    onClick={() => openFileTab(file.id, file.filename)}
                    className="rounded bg-bg-3 px-1.5 py-0.5 text-xs text-t2 transition hover:bg-bg-h hover:text-t1"
                  >
                    {label}
                  </button>
                ) : (
                  <span key={`ev-${i}`} className="rounded bg-bg-3 px-1.5 py-0.5 text-xs text-t2">
                    {label}
                  </span>
                );
              })}
              {dispute.law_refs?.map((l, i) => (
                <button
                  key={`law-${i}`}
                  onClick={() => openLawSearchTab(cleanText(l), true)}
                  className="rounded bg-cy/10 px-1.5 py-0.5 text-xs text-cy transition hover:bg-cy/20"
                >
                  {cleanText(l)}
                </button>
              ))}
            </div>
          )}

          {/* 事實爭議 (收合) */}
          {dispute.facts && dispute.facts.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger className="flex w-full items-center gap-1 py-1 text-xs font-medium text-t3 hover:text-t1">
                <ChevronRight
                  size={12}
                  className="shrink-0 transition-transform duration-200 [[data-state=open]>&]:rotate-90"
                />
                事實爭議 ({dispute.facts.length})
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1">
                  <FactList facts={dispute.facts} />
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        description={`確定刪除「${cleanText(dispute.title || '未命名爭點')}」？相關主張也會一併刪除。`}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};
