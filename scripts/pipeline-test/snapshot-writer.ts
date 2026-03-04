// ── Snapshot Writer ──
// File-system callback for briefPipeline's onStepComplete.
// Lives in scripts/ (not src/server/) to avoid importing 'fs' in Workers.

import { writeFileSync, mkdirSync } from 'fs';

export const createSnapshotWriter = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  return (stepName: string, data: unknown) => {
    writeFileSync(`${dir}/${stepName}.json`, JSON.stringify(data, null, 2));
    console.log(`  Snapshot saved: ${dir}/${stepName}.json`);
  };
};
