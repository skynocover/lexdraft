import { useState, useEffect } from 'react';
import { Check, ChevronDown, ChevronRight, Minus, X } from 'lucide-react';
import type { PipelineStep, PipelineStepChild } from '../../../shared/types';
import { formatDuration } from '../../lib/formatDuration';
import { StageBadge, StepChildren, ReviewContent, isEmptyResult } from './PipelineStageContent';
import type { ReviewData } from './PipelineStageContent';
import { cleanText } from '../../lib/textUtils';

// ── Content data types ──

interface CaseConfirmData {
  type: 'case_confirm';
  files: string[];
  issues: { id: string; title: string }[];
  parties?: { plaintiff: string; defendant: string };
  gaps?: Array<{ description: string; suggestion: string }>;
}

interface ResearchItem {
  name: string;
  type: 'attack' | 'defense_risk' | 'reference';
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

interface StrategyClaim {
  side: 'ours' | 'theirs';
  statement: string;
}

interface StrategyData {
  type: 'strategy';
  sections: {
    id: string;
    section: string;
    subsection?: string;
    claimCount: number;
    claims?: StrategyClaim[];
  }[];
  claimCount: number;
}

type StageContentType = CaseConfirmData | ResearchData | StrategyData | ReviewData;

// ── Status indicator ──

const StatusIndicator = ({ status }: { status: PipelineStep['status'] }) => {
  if (status === 'done') {
    return (
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gr/15">
        <Check size={12} strokeWidth={3} className="text-gr" />
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/15">
        <X size={12} strokeWidth={3} className="text-red-400" />
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

// ── Research item badge helper ──

const itemBadge = (type: ResearchItem['type']) => {
  const map = { attack: '攻', defense_risk: '防', reference: '參' } as const;
  const variantMap = { attack: 'attack', defense_risk: 'defense', reference: 'reference' } as const;
  return <StageBadge variant={variantMap[type]}>{map[type]}</StageBadge>;
};

// ── Main component ──

export const PipelineStages = ({ steps }: { steps: PipelineStep[] }) => (
  <div className="rounded-2xl border border-bd/50 bg-white/2 px-1 py-2">
    {steps.map((step, i) => (
      <StageCard key={i} step={step} isLast={i === steps.length - 1} />
    ))}
  </div>
);

// ── Stage card ──

const StageCard = ({ step, isLast }: { step: PipelineStep; isLast: boolean }) => {
  const [expanded, setExpanded] = useState(false);
  const content = step.content as StageContentType | undefined;
  const hasRenderer =
    content?.type === 'case_confirm' ||
    content?.type === 'research' ||
    content?.type === 'strategy' ||
    content?.type === 'review';
  const hasChildren = !!step.children?.length;
  const isResearchDone = content?.type === 'research' && step.status === 'done';
  const showContent = (hasRenderer || hasChildren) && step.status !== 'pending';

  useEffect(() => {
    if (step.status === 'running') setExpanded(true);
    if (step.status === 'done' && isLast) setExpanded(true);
  }, [step.status, isLast]);

  return (
    <div>
      <button
        onClick={() => showContent && setExpanded(!expanded)}
        className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors ${
          expanded && showContent ? 'bg-white/3' : 'hover:bg-white/2'
        } ${showContent ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <StatusIndicator status={step.status} />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={`text-sm font-semibold ${step.status === 'pending' ? 'text-t3' : 'text-t1'}`}
          >
            {step.label}
          </span>
          {step.detail && (
            <span className={`text-xs ${step.status === 'error' ? 'text-red-400' : 'text-t3'}`}>
              {step.detail}
            </span>
          )}
          {step.durationMs != null && step.status === 'done' && (
            <span className="text-xs text-t3/50">{formatDuration(step.durationMs)}</span>
          )}
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
          {hasChildren && !isResearchDone && <StepChildren children={step.children!} />}
          {hasRenderer && (
            <div className={hasChildren && !isResearchDone ? 'pt-2' : ''}>
              <StageContentRenderer content={content!} />
            </div>
          )}
          {hasChildren && isResearchDone && <SearchLog children={step.children!} />}
        </div>
      )}
    </div>
  );
};

// ── Search log (collapsible, for completed research step) ──

const SearchLog = ({ children }: { children: PipelineStepChild[] }) => {
  const [open, setOpen] = useState(false);
  const totalCount = children.length;
  const emptyCount = children.filter(isEmptyResult).length;

  return (
    <div className="py-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-white/2"
      >
        <ChevronRight
          size={10}
          className={`shrink-0 text-t3 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        />
        <span className="text-xs font-medium text-t3">搜尋紀錄（{totalCount}次）</span>
        {emptyCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-amber-400">
            <Minus size={10} strokeWidth={3} />
            {emptyCount} 次未找到
          </span>
        )}
      </button>
      {open && <StepChildren children={children} />}
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
    case 'strategy':
      return <StrategyContent data={content} />;
    case 'review':
      return <ReviewContent data={content} />;
    default:
      return null;
  }
};

// ── Case confirm content ──

const CaseConfirmContent = ({ data }: { data: CaseConfirmData }) => (
  <div className="space-y-3.5">
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-t3">載入檔案</p>
      <div className="flex flex-wrap gap-1.5">
        {data.files.map((f, i) => (
          <span key={i} className="rounded-md bg-t3/8 px-2.5 py-1 text-xs text-t3">
            {f}
          </span>
        ))}
      </div>
    </div>
    {data.parties && (data.parties.plaintiff || data.parties.defendant) && (
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-t3">當事人</p>
        <div className="flex gap-2">
          {data.parties.plaintiff && (
            <div className="flex-1 rounded-lg border border-emerald-400/10 bg-emerald-400/5 px-3 py-2">
              <span className="text-xs font-semibold text-emerald-400">原告</span>
              <p className="mt-0.5 text-xs text-t2">{data.parties.plaintiff}</p>
            </div>
          )}
          {data.parties.defendant && (
            <div className="flex-1 rounded-lg border border-rose-400/10 bg-rose-400/5 px-3 py-2">
              <span className="text-xs font-semibold text-rose-400">被告</span>
              <p className="mt-0.5 text-xs text-t2">{data.parties.defendant}</p>
            </div>
          )}
        </div>
      </div>
    )}
    {data.issues.length > 0 && (
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-t3">識別爭點</p>
        <div className="space-y-1.5">
          {data.issues.map((issue, i) => (
            <div
              key={issue.id}
              className="flex items-center gap-2.5 rounded-lg border border-blue-400/10 bg-blue-400/5 px-3 py-2"
            >
              <span className="text-xs font-semibold tabular-nums text-blue-400">爭點 {i + 1}</span>
              <span className="text-xs text-t2">{cleanText(issue.title)}</span>
            </div>
          ))}
        </div>
      </div>
    )}
    {data.gaps && data.gaps.length > 0 && (
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-t3">資訊缺口</p>
        <div className="space-y-1.5">
          {data.gaps.map((gap, i) => (
            <div key={i} className="rounded-lg border border-amber-400/15 bg-amber-400/5 px-3 py-2">
              <p className="text-xs text-t2">{cleanText(gap.description)}</p>
              {gap.suggestion && (
                <p className="mt-1 text-xs text-t3">{cleanText(gap.suggestion)}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
);

// ── Strategy content ──

const StrategyContent = ({ data }: { data: StrategyData }) => {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-t3">
        段落配置（{data.claimCount} 項主張）
      </p>
      <div className="space-y-1">
        {data.sections.map((sec) => (
          <div key={sec.id}>
            <button
              onClick={() =>
                sec.claims?.length ? setExpanded(expanded === sec.id ? null : sec.id) : undefined
              }
              className={`flex w-full items-center gap-2.5 rounded-lg border border-ac/10 bg-ac/5 px-3 py-2 text-left ${sec.claims?.length ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span className="flex-1 text-xs text-t2">
                {sec.section}
                {sec.subsection ? ` > ${sec.subsection}` : ''}
              </span>
              {sec.claimCount > 0 && (
                <StageBadge variant="count">{sec.claimCount} 項主張</StageBadge>
              )}
              {sec.claims?.length ? (
                <ChevronRight
                  size={10}
                  className={`shrink-0 text-t3/40 transition-transform duration-150 ${expanded === sec.id ? 'rotate-90' : ''}`}
                />
              ) : null}
            </button>
            {expanded === sec.id && sec.claims && (
              <div className="space-y-0.5 py-1 pl-3">
                {sec.claims.map((claim, ci) => (
                  <div key={ci} className="flex items-start gap-2 px-2 py-0.5">
                    <StageBadge variant={claim.side === 'ours' ? 'attack' : 'defense'}>
                      {claim.side === 'ours' ? '我方' : '對方'}
                    </StageBadge>
                    <span className="flex-1 text-xs text-t3">{claim.statement}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Research content ──

const ResearchContent = ({ data }: { data: ResearchData }) => {
  const [expandedGroup, setExpandedGroup] = useState<number | null>(null);

  return (
    <div className="space-y-1">
      {data.groups.map((group, gi) => (
        <div key={gi}>
          <button
            onClick={() => setExpandedGroup(expandedGroup === gi ? null : gi)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-white/2"
          >
            <ChevronRight
              size={10}
              className={`shrink-0 text-t3 transition-transform duration-200 ${
                expandedGroup === gi ? 'rotate-90' : ''
              }`}
            />
            <span className="flex-1 text-xs font-semibold text-t1">{cleanText(group.section)}</span>
            <StageBadge variant="count">{group.items.length} 條</StageBadge>
          </button>
          {expandedGroup === gi && (
            <div className="space-y-0.5 pb-1 pl-7">
              {group.items.map((item, ii) => (
                <div key={ii} className="flex items-center gap-2 py-0.5 text-xs text-t3">
                  {itemBadge(item.type)}
                  <span className="flex-1 truncate">{cleanText(item.name)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
