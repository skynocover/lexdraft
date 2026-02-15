import { useState, useEffect } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import type { PipelineStep } from '../../../shared/types';

// ── Content data types ──

interface CaseConfirmData {
  type: 'case_confirm';
  files: string[];
  issues: { id: string; title: string }[];
}

interface ResearchItem {
  name: string;
  type: string;
}

interface ResearchGroup {
  section: string;
  items: ResearchItem[];
}

interface ResearchData {
  type: 'research';
  groups: ResearchGroup[];
  totalCount: number;
}

type StageContentType = CaseConfirmData | ResearchData;

// ── Status indicator ──

const StatusIndicator = ({ status }: { status: PipelineStep['status'] }) => {
  if (status === 'done') {
    return (
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gr/15">
        <Check size={12} strokeWidth={3} className="text-gr" />
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="inline-block h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-ac border-t-transparent" />
    );
  }
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-t3/30" />
  );
};

// ── Badge ──

const Badge = ({
  children,
  variant = 'default',
}: {
  children: React.ReactNode;
  variant?: 'default' | 'law' | 'count';
}) => {
  const cls = {
    default: 'bg-t3/10 text-t3',
    law: 'bg-blue-400/10 text-blue-400',
    count: 'bg-t3/[0.08] text-t3',
  }[variant];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {children}
    </span>
  );
};

// ── Main component ──

export const PipelineStages = ({ steps }: { steps: PipelineStep[] }) => (
  <div className="rounded-2xl border border-bd/50 bg-white/[0.02] px-1 py-2">
    {steps.map((step, i) => (
      <StageCard key={i} step={step} isLast={i === steps.length - 1} />
    ))}
  </div>
);

// ── Stage card ──

const StageCard = ({ step, isLast }: { step: PipelineStep; isLast: boolean }) => {
  const [expanded, setExpanded] = useState(false);
  const content = step.content as StageContentType | undefined;
  const hasRenderer = content?.type === 'case_confirm' || content?.type === 'research';
  const showContent = hasRenderer && step.status !== 'pending';

  // Auto-expand running steps and last step when done
  useEffect(() => {
    if (step.status === 'running') setExpanded(true);
    if (step.status === 'done' && isLast) setExpanded(true);
  }, [step.status, isLast]);

  return (
    <div>
      <button
        onClick={() => showContent && setExpanded(!expanded)}
        className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors ${
          expanded && showContent ? 'bg-white/[0.03]' : 'hover:bg-white/[0.02]'
        } ${showContent ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <StatusIndicator status={step.status} />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={`text-sm font-semibold ${step.status === 'pending' ? 'text-t3' : 'text-t1'}`}
          >
            {step.label}
          </span>
          {step.detail && <span className="text-xs text-t3">{step.detail}</span>}
        </div>
        {showContent && (
          <ChevronDown
            size={12}
            className={`shrink-0 text-t3 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {showContent && expanded && (
        <div className="ml-6.5 border-l border-t3/10 pb-3 pl-5">
          <div className="pt-2">
            <StageContentRenderer content={content} />
          </div>
        </div>
      )}
    </div>
  );
};

// ── Content renderer ──

const StageContentRenderer = ({ content }: { content: StageContentType }) => {
  switch (content.type) {
    case 'case_confirm':
      return <CaseConfirmContent data={content} />;
    case 'research':
      return <ResearchContent data={content} />;
    default:
      return null;
  }
};

// ── Case confirm content ──

const CaseConfirmContent = ({ data }: { data: CaseConfirmData }) => (
  <div className="space-y-3.5">
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-t3">載入檔案</p>
      <div className="flex flex-wrap gap-1.5">
        {data.files.map((f, i) => (
          <span key={i} className="rounded-md bg-t3/[0.08] px-2.5 py-1 text-xs text-t3">
            {f}
          </span>
        ))}
      </div>
    </div>
    {data.issues.length > 0 && (
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-t3">識別爭點</p>
        <div className="space-y-1.5">
          {data.issues.map((issue, i) => (
            <div
              key={issue.id}
              className="flex items-center gap-2.5 rounded-lg border border-blue-400/10 bg-blue-400/5 px-3 py-2"
            >
              <span className="text-xs font-semibold tabular-nums text-blue-400">爭點 {i + 1}</span>
              <span className="text-xs text-t2">{issue.title}</span>
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
);

// ── Research content ──

const ResearchContent = ({ data }: { data: ResearchData }) => {
  const [expandedGroup, setExpandedGroup] = useState<number | null>(null);

  return (
    <div className="space-y-1">
      {data.groups.map((group, gi) => (
        <div key={gi}>
          <button
            onClick={() => setExpandedGroup(expandedGroup === gi ? null : gi)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-white/[0.02]"
          >
            <ChevronRight
              size={10}
              className={`shrink-0 text-t3 transition-transform duration-200 ${
                expandedGroup === gi ? 'rotate-90' : ''
              }`}
            />
            <span className="flex-1 text-xs font-semibold text-t1">{group.section}</span>
            <Badge variant="count">{group.items.length} 條</Badge>
          </button>
          {expandedGroup === gi && (
            <div className="space-y-0.5 pb-1 pl-7">
              {group.items.map((item, ii) => (
                <div key={ii} className="flex items-center gap-2 py-0.5 text-xs text-t3">
                  <Badge variant="law">法</Badge>
                  <span className="flex-1 truncate">{item.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
