import { ExternalLink } from 'lucide-react';
import { useTabStore } from '../../stores/useTabStore';

interface SearchLawDisplayProps {
  content: string;
  query?: string;
}

const LINE_REGEX = /^\[([^\]]+)\]\s*(.+?)：(.+)$/;
const MAX_PREVIEW = 3;

/** Join continuation lines (content with embedded newlines) back to their [ID] entry */
const parseEntries = (content: string): string[] => {
  const rawLines = content.split('\n');
  const joined: string[] = [];
  for (const line of rawLines) {
    if (line.startsWith('[')) {
      joined.push(line);
    } else if (
      joined.length > 0 &&
      line.trim() &&
      !line.startsWith('找到') &&
      !line.startsWith('【')
    ) {
      joined[joined.length - 1] += ' ' + line.trim();
    }
  }
  return joined.filter((l) => LINE_REGEX.test(l));
};

export const SearchLawDisplay = ({ content, query }: SearchLawDisplayProps) => {
  const openLawSearchTab = useTabStore((s) => s.openLawSearchTab);

  const entries = parseEntries(content);

  const handleViewFull = () => {
    openLawSearchTab(query, true);
  };

  if (!entries.length) {
    return (
      <div className="space-y-1.5">
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-t2">
          {content.slice(0, 500)}
        </pre>
        {query && (
          <button
            onClick={handleViewFull}
            className="mt-1 flex items-center gap-1 text-xs text-ac hover:underline"
          >
            <ExternalLink size={12} />
            查看完整結果
          </button>
        )}
      </div>
    );
  }

  const shown = entries.slice(0, MAX_PREVIEW);
  const remaining = entries.length - shown.length;

  return (
    <div className="space-y-1.5">
      {query && (
        <p className="text-[11px] text-t3">
          搜尋：<span className="text-t2">{query}</span>
        </p>
      )}
      {shown.map((line, i) => {
        const match = line.match(LINE_REGEX);
        if (!match) return null;
        const [, , title, preview] = match;
        return (
          <div key={i} className="flex items-start gap-1.5">
            <span className="mt-0.5 shrink-0 rounded bg-purple-500/20 px-1 py-0.5 text-[11px] font-medium text-purple-400">
              法規
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-t1">{title}</p>
              <p className="truncate text-[11px] text-t3">{preview}</p>
            </div>
          </div>
        );
      })}
      {query && (
        <button
          onClick={handleViewFull}
          className="mt-1 flex items-center gap-1 text-xs text-ac hover:underline"
        >
          <ExternalLink size={12} />
          {remaining > 0 ? `查看完整結果（還有 ${remaining} 條）` : '查看完整結果'}
        </button>
      )}
    </div>
  );
};
