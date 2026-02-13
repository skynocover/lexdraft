import { useEffect } from 'react'
import { useBriefStore } from '../stores/useBriefStore'

export function useAutoSave(delayMs = 2000) {
  const dirty = useBriefStore((s) => s.dirty)
  const saving = useBriefStore((s) => s.saving)
  const saveBrief = useBriefStore((s) => s.saveBrief)

  useEffect(() => {
    if (!dirty || saving) return
    const timer = setTimeout(() => saveBrief(), delayMs)
    return () => clearTimeout(timer)
  }, [dirty, saving, delayMs])
}
