import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { TimelineEvent } from '../../stores/useAnalysisStore';

interface TimelineCardProps {
  event: TimelineEvent;
  onEdit: (event: TimelineEvent) => void;
  onDelete: (event: TimelineEvent) => void;
}

export const TimelineCard = ({ event, onEdit, onDelete }: TimelineCardProps) => {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
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

          {hovered && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => onEdit(event)}
                className="rounded p-1 text-t3 transition hover:bg-bg-h hover:text-t1"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onDelete(event)}
                className="rounded p-1 text-t3 transition hover:bg-rd/10 hover:text-rd"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
        {event.description && (
          <p className="mt-1 text-sm leading-relaxed text-t2">{event.description}</p>
        )}
      </div>
    </div>
  );
};
