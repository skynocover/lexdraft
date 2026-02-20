import { Scale, ExternalLink } from 'lucide-react';

interface LawViewerProps {
  lawName: string;
  article: string;
  fullText: string | null;
  pcode?: string | null;
}

export const LawViewer = ({ lawName, article, fullText, pcode }: LawViewerProps) => {
  const lawUrl = pcode ? `https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=${pcode}` : null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg-0">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-bd px-6 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pu/10">
          <Scale size={18} className="text-pu" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-t1">{lawName}</h2>
          <p className="text-sm text-t3">{article}</p>
        </div>
        {lawUrl && (
          <a
            href={lawUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-bd px-3 py-1.5 text-xs text-t2 transition hover:bg-bg-h hover:text-t1"
          >
            <ExternalLink size={12} />
            全國法規資料庫
          </a>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {fullText ? (
          <div className="mx-auto max-w-160">
            <p className="text-sm leading-7 text-t1 whitespace-pre-wrap">{fullText}</p>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-t3">無法條內容</p>
          </div>
        )}
      </div>
    </div>
  );
};
