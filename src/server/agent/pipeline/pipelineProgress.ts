// ── Pipeline Progress Tracker ──
// Pure UI state machine for tracking 4-step pipeline progress via SSE.

import type { PipelineStep, PipelineStepChild, SSEEvent } from '../../../shared/types';

export const STEP_CASE = 0;
export const STEP_LAW = 1;
export const STEP_STRATEGY = 2;
export const STEP_WRITER = 3;

export const createProgressTracker = (sendSSE: (event: SSEEvent) => Promise<void>) => {
  const steps: PipelineStep[] = [
    { label: '案件確認', status: 'pending' },
    { label: '法條研究', status: 'pending' },
    { label: '論證策略', status: 'pending' },
    { label: '書狀撰寫', status: 'pending' },
  ];
  const stepStartTimes: (number | null)[] = [null, null, null, null];

  const send = () => sendSSE({ type: 'pipeline_progress', steps: structuredClone(steps) });

  return {
    startStep: async (index: number) => {
      steps[index].status = 'running';
      stepStartTimes[index] = Date.now();
      await send();
    },
    completeStep: async (index: number, detail?: string, content?: Record<string, unknown>) => {
      steps[index].status = 'done';
      if (detail) steps[index].detail = detail;
      if (content) steps[index].content = content;
      if (stepStartTimes[index]) {
        steps[index].durationMs = Date.now() - stepStartTimes[index]!;
      }
      await send();
    },
    setStepChildren: async (index: number, children: PipelineStepChild[]) => {
      steps[index].children = children;
      await send();
    },
    updateStepChild: async (
      stepIndex: number,
      childIndex: number,
      update: Partial<PipelineStepChild>,
    ) => {
      const children = steps[stepIndex].children;
      if (children && children[childIndex]) {
        Object.assign(children[childIndex], update);
        await send();
      }
    },
    setStepContent: async (index: number, content: Record<string, unknown>) => {
      steps[index].content = content;
      await send();
    },
    updateWriting: async (current: number, total: number, sectionLabel: string) => {
      steps[STEP_WRITER] = {
        ...steps[STEP_WRITER],
        label: `書狀撰寫 ${current}/${total}`,
        detail: sectionLabel,
        status: 'running',
      };
      await send();
    },
    failStep: async (index: number, errorMsg: string) => {
      steps[index].status = 'error';
      steps[index].detail = errorMsg;
      if (stepStartTimes[index]) {
        steps[index].durationMs = Date.now() - stepStartTimes[index]!;
      }
      await send();
    },
    completeWriting: async (total: number) => {
      steps[STEP_WRITER] = {
        ...steps[STEP_WRITER],
        label: '書狀撰寫',
        detail: `${total} 段完成`,
        status: 'done',
        durationMs: stepStartTimes[STEP_WRITER]
          ? Date.now() - stepStartTimes[STEP_WRITER]!
          : undefined,
      };
      await send();
    },
  };
};

export type ProgressTracker = ReturnType<typeof createProgressTracker>;
