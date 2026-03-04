/**
 * Replay Step 3 (Writer) from snapshots.
 *
 * Restores ContextStore from step0+step2 snapshots, then re-runs writeSection()
 * for each section. Outputs a quality report and saves results.
 *
 * Usage:
 *   npx tsx scripts/pipeline-test/replay-step3.ts --snapshot-dir snapshots/z4keVNf-20260304/
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ContextStore } from '../../src/server/agent/contextStore';
import { writeSection, getSectionKey } from '../../src/server/agent/pipeline/writerStep';
import type { FileRow } from '../../src/server/agent/pipeline/writerStep';
import { buildQualityReport } from '../../src/server/agent/pipeline/qualityReport';
import { jsonToMap } from '../../src/server/agent/pipeline/snapshotUtils';
import type { Paragraph } from '../../src/client/stores/useBriefStore';
import { createStubContext } from './stub-context';
import { parseArgs, loadSnapshotJson } from './_helpers';

// ── Args ──

const { getArg } = parseArgs();

const SNAPSHOT_DIR = getArg('--snapshot-dir', '');
if (!SNAPSHOT_DIR) {
  console.error('Usage: npx tsx replay-step3.ts --snapshot-dir <path>');
  process.exit(1);
}

const snapshotDir = resolve(SNAPSHOT_DIR);

const main = async () => {
  console.log('═══ Replay Step 3 (Writer) ═══');
  console.log(`Snapshot dir: ${snapshotDir}\n`);

  // Step 0: file content map + briefId
  const step0 = loadSnapshotJson(snapshotDir, 'step0.json');
  const fileContentMap = jsonToMap(step0.fileContentMap as [string, FileRow][]);
  const briefId = (step0.briefId as string) || 'replay-brief';
  console.log(`  briefId: ${briefId}`);
  console.log(`  fileContentMap: ${fileContentMap.size} files`);

  // Step 2: restored ContextStore (has sections, claims, foundLaws, etc.)
  const step2 = loadSnapshotJson(snapshotDir, 'step2.json');
  const store = ContextStore.fromSnapshot(
    step2.store as Parameters<typeof ContextStore.fromSnapshot>[0],
  );
  console.log(`  sections: ${store.sections.length}`);
  console.log(`  claims: ${store.claims.length}`);
  console.log(`  foundLaws: ${store.foundLaws.length}`);
  console.log('');

  // Build stub context (noop DB, real AI env)
  const ctx = createStubContext({
    caseId: ((step0.store as Record<string, unknown>)?.caseId as string) || 'replay-stub',
    briefType: store.briefType,
  });

  // ── Run Writer for each section ──

  const paragraphs: Paragraph[] = [];
  const failedSections: string[] = [];

  for (let i = 0; i < store.sections.length; i++) {
    const section = store.sections[i];
    const sectionKey = getSectionKey(section.section, section.subsection);
    const startTime = Date.now();

    process.stdout.write(`  [${i + 1}/${store.sections.length}] ${sectionKey}...`);

    try {
      const writerCtx = store.getContextForSection(i);
      const paragraph = await writeSection(ctx, briefId, section, writerCtx, fileContentMap, store);

      paragraphs.push(paragraph);

      // Record in store for subsequent sections' review layer
      store.addDraftSection({
        paragraph_id: paragraph.id,
        section_id: section.id,
        content: paragraph.content_md,
        segments: paragraph.segments || [],
        citations: paragraph.citations,
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const lawCites = (paragraph.citations || []).filter((c) => c.type === 'law').length;
      const fileCites = (paragraph.citations || []).filter((c) => c.type === 'file').length;
      console.log(` ✓ ${elapsed}s (law=${lawCites}, file=${fileCites})`);
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(` ✗ ${elapsed}s — ${(err as Error).message}`);
      failedSections.push(sectionKey);
    }
  }

  // ── Quality Report ──

  console.log('\n── Quality Report ──\n');

  const report = buildQualityReport(paragraphs);

  console.log(`Total paragraphs: ${report.totalParagraphs}`);
  console.log(`Total law cites:  ${report.totalLawCites}`);
  console.log(`Total file cites: ${report.totalFileCites}`);
  console.log(`Total chars:      ${report.totalChars}`);
  console.log(`0-law content:    ${report.zeroLawContentSections}/${report.contentSectionCount}`);
  console.log('');

  for (const sec of report.perSection) {
    const label = getSectionKey(sec.section, sec.subsection);
    const lawStr = sec.lawCites === 0 ? '⚠ 0' : String(sec.lawCites);
    console.log(`  ${label.padEnd(40)} law=${lawStr.padEnd(4)} file=${sec.fileCites}`);
  }

  if (failedSections.length > 0) {
    console.log(`\n⚠ Failed sections: ${failedSections.join(', ')}`);
  }

  // ── Save results ──

  const result = {
    timestamp: new Date().toISOString(),
    snapshotDir,
    paragraphs,
    qualityReport: report,
    failedSections,
  };

  const outPath = `${snapshotDir}/replay-step3.json`;
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\nResults saved to: ${outPath}`);
};

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
