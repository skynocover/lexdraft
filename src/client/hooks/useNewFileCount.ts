import { useMemo } from 'react';
import { useCaseStore } from '../stores/useCaseStore';

/**
 * Returns the number of ready files uploaded after the last analysis of the given type.
 * Returns 0 if analysis has never been run (analyzed_at is null).
 */
export const useNewFileCount = (type: 'disputes' | 'timeline'): number => {
  const files = useCaseStore((s) => s.files);
  const analyzedAt = useCaseStore((s) =>
    type === 'disputes' ? s.currentCase?.disputes_analyzed_at : s.currentCase?.timeline_analyzed_at,
  );

  return useMemo(() => {
    if (!analyzedAt) return 0;
    return files.filter((f) => f.status === 'ready' && f.created_at > analyzedAt).length;
  }, [files, analyzedAt]);
};
