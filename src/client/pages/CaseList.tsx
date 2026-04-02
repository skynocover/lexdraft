import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Eye, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../stores/useAuthStore';
import { useCaseStore, type Case } from '../stores/useCaseStore';
import { api } from '../lib/api';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { NewCaseDialog } from '../components/case/NewCaseDialog';

export function CaseList() {
  const cases = useCaseStore((s) => s.cases);
  const setCases = useCaseStore((s) => s.setCases);
  const deleteCase = useCaseStore((s) => s.deleteCase);
  const clearToken = useAuthStore((s) => s.clearToken);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<Case | null>(null);
  const [showNewCase, setShowNewCase] = useState(false);

  useEffect(() => {
    api
      .get<Case[]>('/cases')
      .then(setCases)
      .catch((err) => {
        console.error(err);
        toast.error('載入案件列表失敗');
      })
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (c: Case) => {
    try {
      await deleteCase(c.id);
      toast.success('案件已刪除');
    } catch (err) {
      console.error('deleteCase error:', err);
      toast.error('刪除案件失敗');
    }
    setConfirmDelete(null);
  };

  return (
    <div className="flex h-screen flex-col bg-bg-0">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-bd bg-bg-1 px-4">
        <span className="text-sm font-semibold text-ac">LexDraft</span>
        <button
          onClick={() => {
            clearToken();
            navigate('/login');
          }}
          className="text-xs text-t3 transition hover:text-t1"
        >
          登出
        </button>
      </header>

      {/* Content */}
      <div className="flex flex-1 items-start justify-center overflow-y-auto p-8">
        <div className="w-full max-w-2xl">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-lg font-semibold text-t1">我的案件</h1>
            <button
              onClick={() => setShowNewCase(true)}
              className="rounded bg-ac px-4 py-2 text-sm font-medium text-bg-0 transition hover:opacity-90"
            >
              ＋ 新建案件
            </button>
          </div>

          {/* Demo case — 固定在最上方 */}
          <button
            onClick={() => navigate('/demo')}
            className="flex w-full items-center gap-3 rounded-lg border border-dashed border-ac/30 bg-ac/5 p-4 text-left transition hover:border-ac/50 hover:bg-ac/8"
          >
            <Eye size={16} className="shrink-0 text-ac" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ac">範例案件：車禍損害賠償</p>
              <p className="mt-0.5 text-xs text-t3">查看 AI 產出的書狀、爭點分析與時間軸</p>
            </div>
          </button>

          {loading ? (
            <p className="mt-4 text-sm text-t3">載入中...</p>
          ) : cases.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-bd px-8 py-10">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ac/15 text-xs font-bold text-ac">
                    1
                  </div>
                  <div>
                    <p className="text-sm font-medium text-t1">建立案件</p>
                    <p className="text-xs text-t3">輸入案名和我方立場</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ac/15 text-xs font-bold text-ac">
                    2
                  </div>
                  <div>
                    <p className="text-sm font-medium text-t1">上傳文件</p>
                    <p className="text-xs text-t3">起訴狀、答辯狀、證據等 PDF</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ac/15 text-xs font-bold text-ac">
                    3
                  </div>
                  <div>
                    <p className="text-sm font-medium text-t1">AI 生成</p>
                    <p className="text-xs text-t3">自動分析爭點並撰寫書狀</p>
                  </div>
                </div>
              </div>
              <div className="mt-6">
                <button
                  onClick={() => setShowNewCase(true)}
                  className="rounded bg-ac px-4 py-2 text-sm font-medium text-bg-0 transition hover:opacity-90"
                >
                  新建案件
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              {cases.map((c) => (
                <div
                  key={c.id}
                  className="group flex w-full items-center justify-between rounded-lg border border-bd bg-bg-2 p-4 text-left transition hover:border-bd-l hover:bg-bg-h"
                >
                  <button
                    onClick={() => navigate(`/cases/${c.id}`)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="text-sm font-medium text-t1">{c.title}</p>
                    <div className="mt-1 flex items-center gap-3">
                      {c.case_number && <span className="text-xs text-t3">{c.case_number}</span>}
                      {c.court && <span className="text-xs text-t3">{c.court}</span>}
                    </div>
                    {(c.plaintiff || c.defendant) && (
                      <p className="mt-1 text-xs text-t3">
                        {c.plaintiff || '—'} v. {c.defendant || '—'}
                      </p>
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(c);
                    }}
                    className="shrink-0 rounded p-2 text-t3 opacity-0 transition hover:bg-bg-3 hover:text-rd group-hover:opacity-100"
                    title="刪除案件"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Confirm delete dialog */}
      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        description="確定刪除此案件？"
        confirmLabel="刪除案件"
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
      >
        <p className="text-xs text-t2">{confirmDelete?.title}</p>
        <p className="text-xs text-rd">
          此操作將刪除案件下所有書狀、檔案、對話記錄等資料，且無法復原。
        </p>
      </ConfirmDialog>

      <NewCaseDialog open={showNewCase} onOpenChange={setShowNewCase} />
    </div>
  );
}
