import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Trash2 } from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore';
import { useCaseStore, type Case } from '../stores/useCaseStore';
import { api } from '../lib/api';

export function CaseList() {
  const cases = useCaseStore((s) => s.cases);
  const setCases = useCaseStore((s) => s.setCases);
  const deleteCase = useCaseStore((s) => s.deleteCase);
  const clearToken = useAuthStore((s) => s.clearToken);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<Case | null>(null);

  useEffect(() => {
    api
      .get<Case[]>('/cases')
      .then(setCases)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (c: Case) => {
    try {
      await deleteCase(c.id);
    } catch (err) {
      console.error('deleteCase error:', err);
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
              onClick={() => navigate('/cases/new')}
              className="rounded bg-ac px-4 py-2 text-sm font-medium text-bg-0 transition hover:opacity-90"
            >
              ＋ 新建案件
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-t3">載入中...</p>
          ) : cases.length === 0 ? (
            <div className="rounded-lg border border-dashed border-bd p-12 text-center">
              <p className="mb-2 text-sm text-t2">尚無案件</p>
              <p className="text-xs text-t3">點擊「新建案件」開始使用</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cases.map((c) => (
                <div
                  key={c.id}
                  className="group flex w-full items-center justify-between rounded-lg border border-bd bg-bg-2 p-4 text-left transition hover:border-bd-l hover:bg-bg-h"
                >
                  <button
                    onClick={() => navigate(`/cases/${c.id}`)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <p className="text-sm font-medium text-t1">{c.title}</p>
                    <div className="mt-1 flex items-center gap-3">
                      {c.case_number && <span className="text-xs text-t3">{c.case_number}</span>}
                      {c.court && <span className="text-xs text-t3">{c.court}</span>}
                      {c.case_type && (
                        <span className="rounded bg-bg-3 px-1.5 py-0.5 text-[10px] text-t2">
                          {c.case_type}
                        </span>
                      )}
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
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-80 rounded-lg border border-bd bg-bg-1 p-4 shadow-xl">
            <p className="mb-1 text-sm font-medium text-t1">確定刪除此案件？</p>
            <p className="mb-1 text-xs text-t2">{confirmDelete.title}</p>
            <p className="mb-4 text-xs text-rd">
              此操作將刪除案件下所有書狀、檔案、對話記錄等資料，且無法復原。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded border border-bd px-3 py-1 text-xs text-t2 transition hover:bg-bg-h"
              >
                取消
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                className="rounded bg-rd px-3 py-1 text-xs text-white transition hover:bg-rd/80"
              >
                刪除案件
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
