import { useAnalysisStore } from '../../stores/useAnalysisStore';

export function TimelineTab() {
  const timeline = useAnalysisStore((s) => s.timeline);

  if (timeline.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-t3">尚未產生時間軸，透過 AI 助理分析</p>
      </div>
    );
  }

  return (
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
            <div className="rounded border border-bd bg-bg-2 px-3 py-2">
              <div className="flex items-center gap-2">
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                    event.is_critical ? 'bg-rd/20 text-rd' : 'bg-ac/20 text-ac'
                  }`}
                >
                  {event.date}
                </span>
                <span className="flex-1 truncate text-xs font-medium text-t1">{event.title}</span>
              </div>
              {event.description && (
                <p className="mt-1 text-[11px] leading-4 text-t2">{event.description}</p>
              )}
              {event.source_file && (
                <p className="mt-1 text-[11px] text-t3">來源：{event.source_file}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
