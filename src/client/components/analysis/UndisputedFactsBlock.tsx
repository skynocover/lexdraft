import { useState, useEffect, useRef, type FC } from 'react';
import { ChevronRight, Pencil, Trash2, Check, Plus } from 'lucide-react';
import { useAnalysisStore, type SimpleFact, type Damage } from '../../stores/useAnalysisStore';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { InlineDamageItem } from './InlineDamageItem';
import { formatAmount } from '../../lib/textUtils';

// ── Undisputed Fact Card ──

const FactCard: FC<{ fact: SimpleFact; caseId: string }> = ({ fact, caseId }) => {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const savingRef = useRef(false);
  const updateFact = useAnalysisStore((s) => s.updateFact);
  const removeFact = useAnalysisStore((s) => s.removeFact);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editing]);

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditText(fact.description);
    setEditing(true);
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const trimmed = editText.trim();
      if (!trimmed) {
        setEditing(false);
        return;
      }
      if (trimmed !== fact.description) {
        await updateFact(caseId, fact.id, trimmed);
      }
      setEditing(false);
    } finally {
      savingRef.current = false;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      savingRef.current = true;
      setEditing(false);
      queueMicrotask(() => {
        savingRef.current = false;
      });
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  };

  const handleConfirmDelete = async () => {
    await removeFact(caseId, fact.id);
    setConfirmDelete(false);
  };

  if (editing) {
    return (
      <div className="rounded bg-bg-1 px-2.5 py-1.5">
        <textarea
          ref={textareaRef}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          rows={3}
          className="w-full resize-none rounded border border-ac/50 bg-bg-1 px-1.5 py-1 text-sm text-t1 outline-none focus:border-ac"
        />
      </div>
    );
  }

  return (
    <>
      <div className="group relative rounded bg-bg-1 px-2.5 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <p className="line-clamp-2 pr-12 text-sm text-t2">{fact.description}</p>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-72">
            {fact.description}
          </TooltipContent>
        </Tooltip>
        <span className="pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
          <button
            onClick={handleStartEdit}
            className="rounded p-1 text-t3 transition hover:bg-bg-h hover:text-t1"
          >
            <Pencil className="size-3" />
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="rounded p-1 text-t3 transition hover:bg-rd/10 hover:text-rd"
          >
            <Trash2 className="size-3" />
          </button>
        </span>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        description="確定刪除此不爭執事項？"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
};

// ── Undisputed Facts Block ──

export const UndisputedFactsBlock: FC<{
  facts: SimpleFact[];
  caseId: string;
  undisputedDamages?: Damage[];
  undisputedDamageTotal?: number;
  onEditDamage: (d: Damage) => void;
  onDeleteDamage: (d: Damage) => void;
}> = ({
  facts,
  caseId,
  undisputedDamages = [],
  undisputedDamageTotal = 0,
  onEditDamage,
  onDeleteDamage,
}) => {
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState('');
  const newRef = useRef<HTMLTextAreaElement>(null);
  const savingRef = useRef(false);
  const addFact = useAnalysisStore((s) => s.addFact);

  useEffect(() => {
    if (adding && newRef.current) {
      newRef.current.focus();
    }
  }, [adding]);

  const handleAdd = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const trimmed = newText.trim();
      if (!trimmed) {
        setAdding(false);
        setNewText('');
        return;
      }
      await addFact(caseId, trimmed);
      setNewText('');
      setAdding(false);
    } finally {
      savingRef.current = false;
    }
  };

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setAdding(false);
      setNewText('');
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAdd();
    }
  };

  const totalCount = facts.length + undisputedDamages.length;

  if (totalCount === 0 && !adding) return null;

  return (
    <Collapsible className="rounded border border-bd bg-bg-2 px-3 py-2.5">
      <div className="flex items-center">
        <CollapsibleTrigger className="flex flex-1 items-center gap-1.5 text-left">
          <ChevronRight
            size={14}
            className="shrink-0 text-t3 transition-transform duration-200 [[data-state=open]>&]:rotate-90"
          />
          <Check className="size-3.5 shrink-0 text-gr" />
          <span className="text-xs font-medium text-t2">不爭執事項</span>
          <span className="text-xs text-t3">({totalCount})</span>
          {undisputedDamageTotal > 0 && (
            <span className="ml-auto text-xs text-t3">{formatAmount(undisputedDamageTotal)}</span>
          )}
        </CollapsibleTrigger>
        <button
          onClick={() => setAdding(true)}
          className="rounded p-1 text-t3 transition hover:bg-bg-h hover:text-t1"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <CollapsibleContent className="mt-2 space-y-1 pl-5">
        {facts.map((fact) => (
          <FactCard key={fact.id} fact={fact} caseId={caseId} />
        ))}
        {undisputedDamages.map((d) => (
          <InlineDamageItem
            key={d.id}
            damage={d}
            onEdit={onEditDamage}
            onDelete={onDeleteDamage}
            showRefs
          />
        ))}
        {adding && (
          <div className="rounded bg-bg-1 px-2.5 py-1.5">
            <textarea
              ref={newRef}
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={handleAddKeyDown}
              onBlur={handleAdd}
              rows={2}
              placeholder="輸入不爭執事項..."
              className="w-full resize-none rounded border border-ac/50 bg-bg-1 px-1.5 py-1 text-sm text-t1 outline-none placeholder:text-t3 focus:border-ac"
            />
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};
