import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useBriefStore } from '../stores/useBriefStore';

export function useAutoSave(briefId: string, delayMs = 2000) {
  const { dirty, saving } = useBriefStore(
    useShallow((s) => ({
      dirty: s.briefCache[briefId]?.dirty ?? false,
      saving: s.briefCache[briefId]?.saving ?? false,
    })),
  );
  const saveBrief = useBriefStore((s) => s.saveBrief);

  useEffect(() => {
    if (!dirty || saving) return;
    const timer = setTimeout(() => saveBrief(briefId).catch(() => {}), delayMs);
    return () => clearTimeout(timer);
  }, [dirty, saving, delayMs, briefId]);
}
