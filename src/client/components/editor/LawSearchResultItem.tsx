import { Check, ExternalLink } from 'lucide-react';
import { AccordionItem, AccordionTrigger, AccordionContent } from '../ui/accordion';
import type { LawSearchResult } from '../../stores/useTabStore';

interface LawSearchResultItemProps {
  result: LawSearchResult;
  isSelected: boolean;
  alreadyAdded: boolean;
  onToggle: (id: string) => void;
}

const extractPcode = (id: string): string | null => {
  const dashIdx = id.indexOf('-');
  if (dashIdx <= 0) return null;
  return id.slice(0, dashIdx);
};

export const LawSearchResultItem = ({
  result,
  isSelected,
  alreadyAdded,
  onToggle,
}: LawSearchResultItemProps) => {
  const pcode = extractPcode(result._id);
  const lawUrl = pcode ? `https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=${pcode}` : null;

  return (
    <AccordionItem value={result._id} className="border-bd">
      <div className="flex items-start gap-2.5 px-1">
        {/* Checkbox */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (!alreadyAdded) onToggle(result._id);
          }}
          className={`mt-4 shrink-0 ${alreadyAdded ? 'cursor-default' : 'cursor-pointer'}`}
          disabled={alreadyAdded}
        >
          <div
            className={`flex h-4 w-4 items-center justify-center rounded border transition ${
              alreadyAdded
                ? 'border-t3/30 bg-bg-3'
                : isSelected
                  ? 'border-ac bg-ac'
                  : 'border-t3/50 hover:border-t2'
            }`}
          >
            {(isSelected || alreadyAdded) && (
              <Check size={10} strokeWidth={3} color={alreadyAdded ? '#6c6f85' : 'white'} />
            )}
          </div>
        </button>

        {/* Trigger */}
        <AccordionTrigger className="flex-1 gap-3 py-3 hover:no-underline">
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-t1">
                {result.law_name} {result.article_no}
              </span>
              {alreadyAdded && (
                <span className="rounded bg-bg-3 px-1.5 py-0.5 text-[10px] text-t3">已加入</span>
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-t2">{result.content}</p>
          </div>
        </AccordionTrigger>
      </div>

      <AccordionContent className="pl-7 pr-4 pb-4">
        <p className="text-sm leading-7 text-t1 whitespace-pre-wrap">{result.content}</p>
        {lawUrl && (
          <a
            href={lawUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-ac hover:underline"
          >
            <ExternalLink size={12} />
            全國法規資料庫
          </a>
        )}
      </AccordionContent>
    </AccordionItem>
  );
};
