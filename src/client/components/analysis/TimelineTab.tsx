import { useState } from 'react';
import { CalendarDays, Plus } from 'lucide-react';
import { Button } from '../ui/button';
import { useAnalysisStore, type TimelineEvent } from '../../stores/useAnalysisStore';
import { useChatStore } from '../../stores/useChatStore';
import { useCaseStore } from '../../stores/useCaseStore';
import { TimelineCard } from './TimelineCard';
import { TimelineFormDialog } from './TimelineFormDialog';
import { ConfirmDialog } from '../layout/sidebar/ConfirmDialog';

export function TimelineTab() {
  const timeline = useAnalysisStore((s) => s.timeline);
  const addTimelineEvent = useAnalysisStore((s) => s.addTimelineEvent);
  const updateTimelineEvent = useAnalysisStore((s) => s.updateTimelineEvent);
  const removeTimelineEvent = useAnalysisStore((s) => s.removeTimelineEvent);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const currentCase = useCaseStore((s) => s.currentCase);

  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null);
  const [deletingEvent, setDeletingEvent] = useState<TimelineEvent | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGenerate = () => {
    if (!currentCase || isStreaming) return;
    sendMessage(currentCase.id, '請幫我整理案件時間軸');
  };

  const handleAdd = () => {
    setEditingEvent(null);
    setFormOpen(true);
  };

  const handleEdit = (event: TimelineEvent) => {
    setEditingEvent(event);
    setFormOpen(true);
  };

  const handleDelete = (event: TimelineEvent) => {
    setDeletingEvent(event);
  };

  const handleSubmit = async (data: Omit<TimelineEvent, 'id'>) => {
    if (!currentCase) return;
    setLoading(true);
    try {
      if (editingEvent) {
        await updateTimelineEvent(currentCase.id, editingEvent.id, data);
      } else {
        await addTimelineEvent(currentCase.id, data);
      }
      setFormOpen(false);
    } catch (err) {
      console.error('Timeline save error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!currentCase || !deletingEvent) return;
    try {
      await removeTimelineEvent(currentCase.id, deletingEvent.id);
    } catch (err) {
      console.error('Timeline delete error:', err);
    } finally {
      setDeletingEvent(null);
    }
  };

  return (
    <>
      {timeline.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-4">
          <CalendarDays className="h-8 w-8 text-t3" />
          <p className="text-center text-xs text-t3">尚未產生時間軸</p>
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
              {isStreaming ? 'AI 分析中...' : 'AI 自動整理'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="pb-4">
          {/* Header */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-3 text-[11px] text-t3">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full border-2 border-rd bg-rd/30" />
                關鍵事件
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full border-2 border-ac bg-ac/30" />
                一般事件
              </span>
            </div>
            <button
              onClick={handleAdd}
              className="rounded p-1 text-t3 transition hover:bg-bg-h hover:text-t1"
              title="新增事件"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <div className="relative pl-6">
            <div className="absolute left-2 top-0 bottom-0 w-px bg-bd" />
            <div className="space-y-3">
              {timeline.map((event) => (
                <TimelineCard
                  key={event.id}
                  event={event}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <TimelineFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        event={editingEvent}
        onSubmit={handleSubmit}
        loading={loading}
      />

      {deletingEvent && (
        <ConfirmDialog
          message={`確定刪除事件「${deletingEvent.title}」？`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeletingEvent(null)}
        />
      )}
    </>
  );
}
