import { useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ChevronRight, Loader2 } from 'lucide-react';
import type { PipelineStepChild } from '../../../shared/types';

// ── Badge (shared) ──

export const StageBadge = ({
  children,
  variant = 'default',
}: {
  children: React.ReactNode;
  variant?: 'default' | 'law' | 'count' | 'attack' | 'defense' | 'reference';
}) => {
  const cls = {
    default: 'bg-t3/10 text-t3',
    law: 'bg-blue-400/10 text-blue-400',
    count: 'bg-t3/[0.08] text-t3',
    attack: 'bg-emerald-400/10 text-emerald-400',
    defense: 'bg-amber-400/10 text-amber-400',
    reference: 'bg-t3/10 text-t3',
  }[variant];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {children}
    </span>
  );
};

// ── Step children (search queries) ──

export const StepChildren = ({ children }: { children: PipelineStepChild[] }) => {
  const [expandedChild, setExpandedChild] = useState<number | null>(null);
  return (
    <div className="space-y-0.5 py-1">
      {children.map((child, ci) => (
        <div key={ci}>
          <button
            onClick={() =>
              child.results?.length ? setExpandedChild(expandedChild === ci ? null : ci) : undefined
            }
            className="flex w-full items-center gap-2 px-2 py-1 text-left"
          >
            {child.status === 'running' ? (
              <Loader2 size={10} className="shrink-0 animate-spin text-ac" />
            ) : child.status === 'done' ? (
              <Check size={10} strokeWidth={3} className="shrink-0 text-gr" />
            ) : (
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-t3/30" />
            )}
            <span className="flex-1 truncate text-[11px] text-t3">{child.label}</span>
            {child.detail && <span className="text-[11px] text-t3/60">{child.detail}</span>}
            {child.results?.length ? (
              <ChevronRight
                size={8}
                className={`shrink-0 text-t3/40 transition-transform duration-150 ${expandedChild === ci ? 'rotate-90' : ''}`}
              />
            ) : null}
          </button>
          {expandedChild === ci && child.results && (
            <div className="space-y-0.5 pb-1 pl-7">
              {child.results.map((r, ri) => (
                <p key={ri} className="text-[11px] text-t3/70">
                  {r}
                </p>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// ── Review content types ──

export interface ReviewIssueData {
  severity: 'critical' | 'warning';
  type: string;
  description: string;
  suggestion: string;
  paragraph_id?: string;
}

export interface ReviewData {
  type: 'review';
  passed: boolean;
  criticalCount: number;
  warningCount: number;
  structuralIssueCount: number;
  issues: ReviewIssueData[];
}

// ── Review content ──

export const ReviewContent = ({ data }: { data: ReviewData }) => {
  const [showIssues, setShowIssues] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {data.passed ? (
          <CheckCircle2 size={14} className="text-gr" />
        ) : (
          <AlertTriangle size={14} className="text-amber-400" />
        )}
        <span className={`text-xs font-semibold ${data.passed ? 'text-gr' : 'text-amber-400'}`}>
          {data.passed ? '品質審查通過' : '品質審查未通過'}
        </span>
      </div>
      {(data.criticalCount > 0 || data.warningCount > 0) && (
        <p className="text-[11px] text-t3">
          {data.criticalCount > 0 && `${data.criticalCount} 項重要問題`}
          {data.criticalCount > 0 && data.warningCount > 0 && '、'}
          {data.warningCount > 0 && `${data.warningCount} 項建議`}
        </p>
      )}
      {data.issues.length > 0 && (
        <div>
          <button
            onClick={() => setShowIssues(!showIssues)}
            className="flex items-center gap-1.5 text-[11px] text-ac hover:underline"
          >
            <ChevronRight
              size={8}
              className={`transition-transform duration-150 ${showIssues ? 'rotate-90' : ''}`}
            />
            {showIssues ? '收合' : '查看'} {data.issues.length} 項問題
          </button>
          {showIssues && (
            <div className="mt-1.5 space-y-1">
              {data.issues.map((issue, i) => (
                <div
                  key={i}
                  className={`rounded-lg border px-3 py-2 ${
                    issue.severity === 'critical'
                      ? 'border-red-400/15 bg-red-400/5'
                      : 'border-amber-400/15 bg-amber-400/5'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <StageBadge variant={issue.severity === 'critical' ? 'attack' : 'defense'}>
                      {issue.severity === 'critical' ? '重要' : '建議'}
                    </StageBadge>
                    <span className="flex-1 text-xs text-t2">{issue.description}</span>
                  </div>
                  {issue.suggestion && (
                    <p className="mt-1 pl-9 text-[11px] text-t3">{issue.suggestion}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
