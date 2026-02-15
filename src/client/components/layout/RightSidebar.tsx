import { useRef, useState, useMemo } from 'react';
import { ChevronsRight, Trash2, Plus, Search } from 'lucide-react';
import { useCaseStore, type CaseFile } from '../../stores/useCaseStore';
import { useBriefStore } from '../../stores/useBriefStore';
import { useTabStore } from '../../stores/useTabStore';
import { useUIStore } from '../../stores/useUIStore';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/useAuthStore';

import { SectionHeader } from './sidebar/SectionHeader';
import { ConfirmDialog } from './sidebar/ConfirmDialog';
import { FileGroup } from './sidebar/FileGroup';
import { LawRefCard } from './sidebar/LawRefCard';
import { LawSearchDialog } from './sidebar/LawSearchDialog';

type Category = 'ours' | 'theirs' | 'court' | 'evidence' | 'other';

const FILE_GROUPS: { key: Category; label: string }[] = [
  { key: 'ours', label: '我方書狀' },
  { key: 'theirs', label: '對方書狀' },
  { key: 'court', label: '法院文件' },
  { key: 'evidence', label: '證據資料' },
];

export function RightSidebar() {
  const currentCase = useCaseStore((s) => s.currentCase);
  const caseFiles = useCaseStore((s) => s.files);
  const setFiles = useCaseStore((s) => s.setFiles);
  const rebuttalTargetFileIds = useBriefStore((s) => s.rebuttalTargetFileIds);
  const lawRefs = useBriefStore((s) => s.lawRefs);
  const briefs = useBriefStore((s) => s.briefs);
  const currentBrief = useBriefStore((s) => s.currentBrief);
  const deleteBrief = useBriefStore((s) => s.deleteBrief);
  const removeLawRef = useBriefStore((s) => s.removeLawRef);
  const panels = useTabStore((s) => s.panels);
  const focusedPanelId = useTabStore((s) => s.focusedPanelId);
  const openBriefTab = useTabStore((s) => s.openBriefTab);
  const closeTab = useTabStore((s) => s.closeTab);

  // Derive activeTabId from the focused panel
  const focusedPanel = panels.find((p) => p.id === focusedPanelId);
  const activeTabId = focusedPanel?.activeTabId ?? null;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const [briefsOpen, setBriefsOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(true);
  const [lawRefsOpen, setLawRefsOpen] = useState(true);
  const [lawSearchOpen, setLawSearchOpen] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);

  const grouped = FILE_GROUPS.map((g) => ({
    ...g,
    files: caseFiles.filter((f) => f.category === g.key),
  }));
  const otherFiles = caseFiles.filter(
    (f) => !f.category || !FILE_GROUPS.some((g) => g.key === f.category),
  );

  // Two-tier law refs: cited in current brief vs available pool
  const { citedLawRefs, availableLawRefs } = useMemo(() => {
    const citedLabels = new Set<string>();
    if (currentBrief?.content_structured?.paragraphs) {
      for (const p of currentBrief.content_structured.paragraphs) {
        for (const c of p.citations) {
          if (c.type === 'law') citedLabels.add(c.label);
        }
        if (p.segments) {
          for (const seg of p.segments) {
            for (const c of seg.citations) {
              if (c.type === 'law') citedLabels.add(c.label);
            }
          }
        }
      }
    }
    const cited: typeof lawRefs = [];
    const available: typeof lawRefs = [];
    for (const ref of lawRefs) {
      const label = `${ref.law_name} ${ref.article}`;
      if (citedLabels.has(label)) {
        cited.push(ref);
      } else {
        available.push(ref);
      }
    }
    return { citedLawRefs: cited, availableLawRefs: available };
  }, [lawRefs, currentBrief]);

  const totalFiles = caseFiles.length;
  const readyFiles = caseFiles.filter((f) => f.status === 'ready').length;
  const processingFiles = caseFiles.filter(
    (f) => f.status === 'pending' || f.status === 'processing',
  ).length;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || !currentCase) return;

    setUploading(true);
    for (const file of Array.from(fileList)) {
      if (file.type !== 'application/pdf') continue;
      if (file.size > 20 * 1024 * 1024) continue;

      const formData = new FormData();
      formData.append('file', file);

      const token = useAuthStore.getState().token;
      try {
        const res = await fetch(`/api/cases/${currentCase.id}/files`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (res.ok) {
          const newFile = (await res.json()) as CaseFile;
          setFiles([...useCaseStore.getState().files, newFile]);
        }
      } catch (err) {
        console.error('Upload failed:', err);
      }
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCategoryChange = async (fileId: string, category: string) => {
    try {
      const updated = await api.put<CaseFile>(`/files/${fileId}`, { category });
      setFiles(caseFiles.map((f) => (f.id === fileId ? { ...f, ...updated } : f)));
    } catch (err) {
      console.error('Category update failed:', err);
    }
  };

  const handleDropFile = async (fileId: string, newCategory: string) => {
    await handleCategoryChange(fileId, newCategory);
  };

  const handleDelete = async (fileId: string) => {
    try {
      await api.delete(`/files/${fileId}`);
      setFiles(caseFiles.filter((f) => f.id !== fileId));
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const handleDeleteBrief = async () => {
    if (!confirmDelete) return;
    const briefId = confirmDelete.id;
    setConfirmDelete(null);

    // Find the panel containing this brief tab and close it
    const tabId = `brief:${briefId}`;
    const { panels: currentPanels } = useTabStore.getState();
    const ownerPanel = currentPanels.find((p) => p.tabIds.includes(tabId));
    if (ownerPanel) {
      closeTab(tabId, ownerPanel.id);
    }
    await deleteBrief(briefId);
  };

  const toggleRightSidebar = useUIStore((s) => s.toggleRightSidebar);

  return (
    <aside className="flex w-80 min-h-0 shrink-0 flex-col border-l border-bd bg-bg-1 overflow-y-auto">
      {/* Sidebar header with collapse button */}
      <div className="flex items-center justify-between border-b border-bd px-3 py-2">
        <span className="text-xs font-medium text-t2">案件資料</span>
        <button
          onClick={toggleRightSidebar}
          className="rounded p-1 text-t3 transition hover:bg-bg-h hover:text-t1"
          title="收合側邊欄"
        >
          <ChevronsRight size={14} />
        </button>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          message={`確定要刪除「${confirmDelete.title}」嗎？此操作無法復原。`}
          onConfirm={handleDeleteBrief}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* 書狀草稿區塊 */}
      <div className="border-b border-bd">
        <SectionHeader
          label="書狀草稿"
          count={briefs.length}
          countUnit="份"
          open={briefsOpen}
          onToggle={() => setBriefsOpen(!briefsOpen)}
        />
        {briefsOpen &&
          (briefs.length === 0 ? (
            <div className="px-3 pb-3">
              <p className="text-center text-[11px] text-t3">尚無書狀</p>
            </div>
          ) : (
            <div className="px-1 pb-2">
              {briefs.map((b) => {
                const tabId = `brief:${b.id}`;
                const isActive = activeTabId === tabId;
                const title = b.title || b.brief_type;
                return (
                  <div
                    key={b.id}
                    className={`group flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition ${
                      isActive ? 'bg-ac/10 text-ac' : 'hover:bg-bg-h'
                    }`}
                  >
                    <button
                      onClick={() => openBriefTab(b.id, title)}
                      className="flex flex-1 items-start gap-2 min-w-0"
                    >
                      <span className={`mt-0.5 text-[11px] ${isActive ? 'text-ac' : 'text-ac/60'}`}>
                        DOC
                      </span>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`truncate text-xs ${isActive ? 'text-ac font-medium' : 'text-t1'}`}
                        >
                          {b.title || '書狀'}
                        </p>
                        <span className="text-[10px] text-t3">
                          {{
                            complaint: '起訴狀',
                            defense: '答辯狀',
                            preparation: '準備書狀',
                            appeal: '上訴狀',
                          }[b.brief_type] || b.brief_type}
                        </span>
                      </div>
                    </button>
                    <button
                      onClick={() => setConfirmDelete({ id: b.id, title })}
                      className="mt-0.5 shrink-0 rounded p-1 text-t3 opacity-0 transition hover:text-rd group-hover:opacity-100"
                      title="刪除書狀"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
      </div>

      {/* 案件卷宗區塊 */}
      <div className="border-b border-bd">
        <div className="flex items-center">
          <div className="flex-1">
            <SectionHeader
              label="案件卷宗"
              count={totalFiles}
              countUnit="個檔案"
              open={filesOpen}
              onToggle={() => setFilesOpen(!filesOpen)}
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            multiple
            onChange={handleUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="mr-2 rounded p-1 text-t3 transition hover:bg-bg-h hover:text-ac disabled:opacity-50"
            title="上傳檔案"
          >
            {uploading ? (
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-ac border-t-transparent" />
            ) : (
              <Plus size={14} />
            )}
          </button>
        </div>
        {filesOpen && (
          <>
            {processingFiles > 0 && (
              <div className="mx-3 mb-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-yl">處理中...</span>
                  <span className="text-[10px] text-t3">
                    {readyFiles}/{totalFiles}
                  </span>
                </div>
                <div className="h-1 rounded-full bg-bg-3">
                  <div
                    className="h-1 rounded-full bg-ac transition-all"
                    style={{
                      width: totalFiles > 0 ? `${(readyFiles / totalFiles) * 100}%` : '0%',
                    }}
                  />
                </div>
              </div>
            )}

            {grouped.map((g) => (
              <FileGroup
                key={g.key}
                label={g.label}
                groupKey={g.key}
                files={g.files}
                rebuttalTargetIds={rebuttalTargetFileIds}
                onDelete={handleDelete}
                onDropFile={handleDropFile}
              />
            ))}

            {otherFiles.length > 0 && (
              <FileGroup
                label="其他"
                groupKey="other"
                files={otherFiles}
                rebuttalTargetIds={rebuttalTargetFileIds}
                onDelete={handleDelete}
                onDropFile={handleDropFile}
              />
            )}

            {caseFiles.length === 0 && (
              <div className="px-3 pb-3">
                <p className="text-center text-[11px] text-t3">尚無檔案</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* 法條引用區塊 */}
      <div>
        <div className="flex items-center">
          <div className="flex-1">
            <SectionHeader
              label="法條引用"
              count={lawRefs.length}
              countUnit="條"
              open={lawRefsOpen}
              onToggle={() => setLawRefsOpen(!lawRefsOpen)}
            />
          </div>
          <button
            onClick={() => setLawSearchOpen(true)}
            className="mr-2 rounded p-1 text-t3 transition hover:bg-bg-h hover:text-ac"
            title="搜尋法條"
          >
            <Search size={14} />
          </button>
        </div>
        {lawRefsOpen && (
          <div className="px-1 pb-3">
            {citedLawRefs.length === 0 && availableLawRefs.length === 0 ? (
              <div className="px-2 py-4 text-center">
                <p className="text-[11px] text-t3">尚無法條</p>
                <button
                  onClick={() => setLawSearchOpen(true)}
                  className="mt-1.5 text-[11px] text-ac transition hover:underline"
                >
                  搜尋並加入法條
                </button>
              </div>
            ) : (
              <div className="space-y-1 px-1">
                {/* 已引用 */}
                {citedLawRefs.length > 0 && (
                  <>
                    <p className="px-1 pt-1 text-[9px] font-medium uppercase tracking-wider text-t3">
                      已引用 ({citedLawRefs.length})
                    </p>
                    {citedLawRefs.map((ref) => (
                      <LawRefCard key={ref.id} lawRef={ref} cited />
                    ))}
                  </>
                )}
                {/* 備用 */}
                {availableLawRefs.length > 0 && (
                  <>
                    <p className="px-1 pt-2 text-[9px] font-medium uppercase tracking-wider text-t3">
                      備用 ({availableLawRefs.length})
                    </p>
                    {availableLawRefs.map((ref) => (
                      <LawRefCard
                        key={ref.id}
                        lawRef={ref}
                        onRemove={ref.source === 'manual' ? removeLawRef : undefined}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <LawSearchDialog open={lawSearchOpen} onClose={() => setLawSearchOpen(false)} />
    </aside>
  );
}
