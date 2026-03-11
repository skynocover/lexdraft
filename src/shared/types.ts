// ── Simple Fact (shared between server pipeline + client stores) ──

export interface SimpleFact {
  id: string;
  description: string;
}

// SSE Event Protocol
export type SSEEvent =
  | { type: 'message_start'; message_id: string; role: 'assistant' }
  | { type: 'text_delta'; delta: string }
  | { type: 'message_end'; message_id: string }
  | {
      type: 'tool_call_start';
      message_id: string;
      tool_name: string;
      tool_args: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      message_id: string;
      tool_name: string;
      result_summary: string;
      success: boolean;
    }
  | { type: 'progress'; current: number; total: number }
  | { type: 'pipeline_timing'; totalDurationMs: number }
  | {
      type: 'brief_update';
      brief_id: string;
      action:
        | 'create_brief'
        | 'add_paragraph'
        | 'update_paragraph'
        | 'set_disputes'
        | 'set_damages'
        | 'set_law_refs'
        | 'set_timeline'
        | 'set_parties'
        | 'set_claims'
        | 'set_exhibits'
        | 'set_undisputed_facts'
        | 'set_information_gaps';
      data: unknown;
    }
  | { type: 'pipeline_progress'; steps: PipelineStep[] }
  | { type: 'suggested_actions'; actions: { label: string; prompt: string }[] }
  | { type: 'snapshot_data'; stepName: string; data: unknown }
  | { type: 'error'; message: string }
  | { type: 'done' };

// Pipeline progress step (used by write_full_brief)
export interface PipelineStepChild {
  label: string;
  detail?: string;
  status: 'done' | 'running' | 'pending' | 'error';
  results?: string[];
}

export interface PipelineStep {
  label: string;
  detail?: string;
  status: 'done' | 'running' | 'pending' | 'error';
  durationMs?: number;
  children?: PipelineStepChild[];
  content?: Record<string, unknown>;
}

// Analysis types (single source of truth for client + server)
export const ANALYSIS_TYPES = ['disputes', 'damages', 'timeline'] as const;
export type AnalysisType = (typeof ANALYSIS_TYPES)[number];

/** Chinese display labels for each analysis type */
export const ANALYSIS_LABELS: Record<AnalysisType, string> = {
  disputes: '爭點',
  damages: '金額',
  timeline: '時間軸',
};

/** Action labels for AI analysis buttons */
export const ANALYSIS_ACTION_LABELS: Record<AnalysisType, string> = {
  disputes: 'AI 自動分析',
  damages: 'AI 自動計算',
  timeline: 'AI 自動整理',
};

/** Tooltip labels for reanalyze buttons */
export const ANALYSIS_REANALYZE_LABELS: Record<AnalysisType, string> = {
  disputes: '重新分析爭點',
  damages: '重新計算金額',
  timeline: '重新產生時間軸',
};

// Chat request body
export interface ChatRequest {
  message: string;
  briefContext?: {
    brief_id: string;
    title: string;
    paragraphs: { id: string; section: string; subsection: string; content_preview?: string }[];
  };
}

// Chat message record (stored in D1, returned by GET /messages)
export interface ChatMessageRecord {
  id: string;
  case_id: string;
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result';
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
