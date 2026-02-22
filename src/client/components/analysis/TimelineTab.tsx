import { CalendarDays } from 'lucide-react';
import { Button } from '../ui/button';
import { useAnalysisStore } from '../../stores/useAnalysisStore';
import { useChatStore } from '../../stores/useChatStore';
import { useCaseStore } from '../../stores/useCaseStore';

export function TimelineTab() {
  const timeline = useAnalysisStore((s) => s.timeline);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const currentCase = useCaseStore((s) => s.currentCase);

  const handleGenerate = () => {
    if (!currentCase || isStreaming) return;
    sendMessage(currentCase.id, '請幫我整理案件時間軸');
  };

  if (timeline.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4">
        <CalendarDays className="h-8 w-8 text-t3" />
        <p className="text-center text-xs text-t3">尚未產生時間軸</p>
        <Button
          variant="outline"
          size="sm"
          disabled={!currentCase || isStreaming}
          onClick={handleGenerate}
        >
          {isStreaming ? 'AI 分析中...' : 'AI 自動整理時間軸'}
        </Button>
      </div>
    );
  }

  return (
    <div className="pb-4">
      {/* Legend */}
      <div className="mb-3 flex items-center gap-3 text-[11px] text-t3">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full border-2 border-rd bg-rd/30" />
          關鍵事件
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full border-2 border-ac bg-ac/30" />
          一般事件
        </span>
      </div>

      <div className="relative pl-6">
        {/* Vertical line */}
        <div className="absolute left-2 top-0 bottom-0 w-px bg-bd" />

        <div className="space-y-3">
          {timeline.map((event, i) => (
            <div key={i} className="relative">
              {/* Dot */}
              <div
                className={`absolute -left-[18px] top-1 h-2.5 w-2.5 rounded-full border-2 ${
                  event.is_critical ? 'border-rd bg-rd/30' : 'border-ac bg-ac/30'
                }`}
              />

              {/* Content */}
              <div className="rounded border border-bd bg-bg-2 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${
                      event.is_critical ? 'bg-rd/20 text-rd' : 'bg-ac/20 text-ac'
                    }`}
                  >
                    {event.date}
                  </span>
                  <span className="flex-1 truncate text-sm font-medium text-t1">{event.title}</span>
                </div>
                {event.description && (
                  <p className="mt-1 text-sm leading-relaxed text-t2">{event.description}</p>
                )}
                {event.source_file && (
                  <p className="mt-1 text-xs text-t3">來源：{event.source_file}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
