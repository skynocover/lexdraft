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
  | {
      type: 'usage';
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      estimated_cost_ntd: number;
    }
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
        | 'set_claims';
      data: unknown;
    }
  | { type: 'pipeline_progress'; steps: PipelineStep[] }
  | { type: 'suggested_actions'; actions: { label: string; prompt: string }[] }
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
  children?: PipelineStepChild[];
  content?: Record<string, unknown>;
}

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
