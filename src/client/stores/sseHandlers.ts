import { toast } from 'sonner';
import { useBriefStore, type Brief, type Paragraph, type LawRef } from './useBriefStore';
import {
  useAnalysisStore,
  type Dispute,
  type Damage,
  type TimelineEvent,
  type Party,
  type ClaimGraph,
} from './useAnalysisStore';
import { useTabStore } from './useTabStore';
import { useRewindStore } from './useRewindStore';
import type { SSEEvent } from '../../shared/types';
import type { ChatMessage } from './useChatStore';

export interface SSEContext {
  currentAssistantId: string | null;
  rewindTargetId: string | null;
}

interface SSEActions {
  addMessage: (message: ChatMessage) => void;
  appendToMessage: (id: string, text: string) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  setAgentProgress: (progress: { current: number; total: number } | null) => void;
  setTokenUsage: (
    usage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      estimated_cost_ntd: number;
    } | null,
  ) => void;
  setError: (error: string | null) => void;
  getMessages: () => ChatMessage[];
}

export const handleSSEEvent = (
  event: SSEEvent,
  ctx: SSEContext,
  actions: SSEActions,
): SSEContext => {
  let { currentAssistantId, rewindTargetId } = ctx;

  switch (event.type) {
    case 'message_start': {
      currentAssistantId = event.message_id;
      const rStore = useRewindStore.getState();
      const prevSnap = rewindTargetId ? rStore.snapshots[rewindTargetId] : null;
      if (prevSnap?.hadChanges && rewindTargetId) {
        rStore.transferSnapshot(rewindTargetId, event.message_id);
      } else {
        if (rewindTargetId) {
          rStore.removeSnapshot(rewindTargetId);
        }
        rStore.captureSnapshot(event.message_id);
      }
      rewindTargetId = event.message_id;
      actions.addMessage({
        id: event.message_id,
        role: 'assistant',
        content: '',
        created_at: new Date().toISOString(),
      });
      break;
    }

    case 'text_delta':
      if (currentAssistantId) {
        actions.appendToMessage(currentAssistantId, event.delta);
      }
      break;

    case 'message_end':
      currentAssistantId = null;
      break;

    case 'tool_call_start':
      actions.addMessage({
        id: event.message_id,
        role: 'tool_call',
        content: event.tool_name,
        metadata: {
          tool_name: event.tool_name,
          tool_args: event.tool_args,
          status: 'running',
        },
        created_at: new Date().toISOString(),
      });
      if (event.tool_name === 'write_brief_section' && event.tool_args?.relevant_file_ids) {
        useBriefStore
          .getState()
          .setRebuttalTargetFileIds(event.tool_args.relevant_file_ids as string[]);
      }
      break;

    case 'tool_result': {
      const existing = actions.getMessages().find((m) => m.id === event.message_id);
      actions.updateMessage(event.message_id, {
        metadata: {
          ...existing?.metadata,
          tool_name: event.tool_name,
          result_summary: event.result_summary,
          success: event.success,
          status: 'done',
        },
      });
      actions.addMessage({
        id: event.message_id + '_result',
        role: 'tool_result',
        content: event.result_summary,
        metadata: {
          tool_call_id: event.message_id,
          tool_name: event.tool_name,
          success: event.success,
        },
        created_at: new Date().toISOString(),
      });
      break;
    }

    case 'pipeline_progress': {
      const allMsgs = actions.getMessages();
      for (let i = allMsgs.length - 1; i >= 0; i--) {
        if (allMsgs[i].role === 'tool_call' && allMsgs[i].metadata?.status === 'running') {
          actions.updateMessage(allMsgs[i].id, {
            metadata: { ...allMsgs[i].metadata, pipeline_steps: event.steps },
          });
          break;
        }
      }
      break;
    }

    case 'progress':
      actions.setAgentProgress({ current: event.current, total: event.total });
      break;

    case 'usage':
      actions.setTokenUsage({
        prompt_tokens: event.prompt_tokens,
        completion_tokens: event.completion_tokens,
        total_tokens: event.total_tokens,
        estimated_cost_ntd: event.estimated_cost_ntd,
      });
      break;

    case 'brief_update': {
      if (rewindTargetId) {
        useRewindStore.getState().markHasChanges(rewindTargetId);
      }
      handleBriefUpdate(event);
      break;
    }

    case 'suggested_actions': {
      const msgs = actions.getMessages();
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          actions.updateMessage(msgs[i].id, {
            metadata: {
              ...msgs[i].metadata,
              suggested_actions: event.actions,
            },
          });
          break;
        }
      }
      break;
    }

    case 'error':
      actions.setError(event.message);
      toast.error('發生錯誤', { description: event.message });
      break;

    case 'done':
      break;
  }

  return { currentAssistantId, rewindTargetId };
};

const handleBriefUpdate = (event: Extract<SSEEvent, { type: 'brief_update' }>) => {
  const briefStore = useBriefStore.getState();
  const analysisStore = useAnalysisStore.getState();

  switch (event.action) {
    case 'create_brief': {
      const newBrief = event.data as Brief;
      briefStore.setBriefs([...briefStore.briefs, newBrief]);
      briefStore.setCurrentBrief(newBrief);
      useTabStore.getState().openBriefTab(newBrief.id, newBrief.title || newBrief.brief_type);
      toast.success('書狀已建立', { description: newBrief.title || newBrief.brief_type });
      break;
    }
    case 'add_paragraph': {
      const p = event.data as Paragraph;
      if (!event.brief_id || briefStore.currentBrief?.id === event.brief_id) {
        briefStore.addParagraph(p);
      }
      break;
    }
    case 'update_paragraph': {
      const p = event.data as Paragraph;
      if (!event.brief_id || briefStore.currentBrief?.id === event.brief_id) {
        briefStore.updateParagraph(p.id, p);
      }
      break;
    }
    case 'set_disputes': {
      const disputes = event.data as Dispute[];
      analysisStore.setDisputes(disputes);
      if (disputes.length > 0)
        toast.success('爭點分析完成', { description: `${disputes.length} 個爭點` });
      break;
    }
    case 'set_damages': {
      const damages = event.data as Damage[];
      analysisStore.setDamages(damages);
      if (damages.length > 0) {
        const total = damages.reduce((s, d) => s + d.amount, 0);
        toast.success('金額計算完成', { description: `NT$ ${total.toLocaleString()}` });
      }
      break;
    }
    case 'set_law_refs':
      briefStore.setLawRefs(event.data as LawRef[]);
      break;
    case 'set_timeline': {
      const timeline = event.data as TimelineEvent[];
      analysisStore.setTimeline(timeline);
      if (timeline.length > 0)
        toast.success('時間軸已產生', { description: `${timeline.length} 個事件` });
      break;
    }
    case 'set_parties':
      analysisStore.setParties(event.data as Party[]);
      break;
    case 'set_claims': {
      const claims = event.data as ClaimGraph[];
      analysisStore.setClaims(claims);
      if (claims.length > 0)
        toast.success('主張分析已產生', { description: `${claims.length} 項主張` });
      break;
    }
  }
};
