import { useState, useEffect, useMemo } from 'react';
import { useCaseStore } from '../../../stores/useCaseStore';
import { Loader2 } from 'lucide-react';
import { CASE_TYPES } from '../../../lib/caseConstants';

interface FormData {
  title: string;
  case_number: string;
  court: string;
  case_type: string;
  client_role: string;
  plaintiff: string;
  defendant: string;
  case_instructions: string;
}

export const CaseInfoTab = () => {
  const currentCase = useCaseStore((s) => s.currentCase);
  const updateCase = useCaseStore((s) => s.updateCase);

  const [form, setForm] = useState<FormData>({
    title: '',
    case_number: '',
    court: '',
    case_type: '',
    client_role: '',
    plaintiff: '',
    defendant: '',
    case_instructions: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (currentCase) {
      setForm({
        title: currentCase.title || '',
        case_number: currentCase.case_number || '',
        court: currentCase.court || '',
        case_type: currentCase.case_type || '',
        client_role: currentCase.client_role || '',
        plaintiff: currentCase.plaintiff || '',
        defendant: currentCase.defendant || '',
        case_instructions: currentCase.case_instructions || '',
      });
    }
  }, [currentCase]);

  const dirty = useMemo(() => {
    if (!currentCase) return false;
    return (
      form.title !== (currentCase.title || '') ||
      form.case_number !== (currentCase.case_number || '') ||
      form.court !== (currentCase.court || '') ||
      form.case_type !== (currentCase.case_type || '') ||
      form.client_role !== (currentCase.client_role || '') ||
      form.plaintiff !== (currentCase.plaintiff || '') ||
      form.defendant !== (currentCase.defendant || '') ||
      form.case_instructions !== (currentCase.case_instructions || '')
    );
  }, [form, currentCase]);

  const set =
    (key: keyof FormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSave = async () => {
    if (!currentCase) return;
    if (!form.title.trim()) {
      setError('案件名稱為必填');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateCase(currentCase.id, {
        title: form.title.trim(),
        case_number: form.case_number.trim() || null,
        court: form.court.trim() || null,
        case_type: form.case_type || null,
        client_role: (form.client_role as 'plaintiff' | 'defendant') || null,
        plaintiff: form.plaintiff.trim() || null,
        defendant: form.defendant.trim() || null,
        case_instructions: form.case_instructions.trim() || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  if (!currentCase) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-t3">尚未選擇案件</p>
      </div>
    );
  }

  const inputClass =
    'w-full rounded border border-bd bg-bg-3 px-2.5 py-1.5 text-xs text-t1 outline-none placeholder:text-t3 focus:border-ac';

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-3">
      <div className="space-y-3">
        {/* 案件名稱 */}
        <div>
          <label className="mb-1 block text-xs text-t2">
            案件名稱 <span className="text-rd">*</span>
          </label>
          <input
            value={form.title}
            onChange={set('title')}
            placeholder="案件名稱"
            className={inputClass}
          />
        </div>

        {/* 案號 */}
        <div>
          <label className="mb-1 block text-xs text-t2">案號</label>
          <input
            value={form.case_number}
            onChange={set('case_number')}
            placeholder="114年度雄簡字第○○號"
            className={inputClass}
          />
        </div>

        {/* 法院 */}
        <div>
          <label className="mb-1 block text-xs text-t2">法院</label>
          <input
            value={form.court}
            onChange={set('court')}
            placeholder="高雄地方法院鳳山簡易庭"
            className={inputClass}
          />
        </div>

        {/* 案件類型 */}
        <div>
          <label className="mb-1 block text-xs text-t2">案件類型</label>
          <select value={form.case_type} onChange={set('case_type')} className={inputClass}>
            <option value="">請選擇</option>
            {CASE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {/* 我方立場 */}
        <div>
          <label className="mb-1 block text-xs text-t2">我方立場</label>
          <div className="flex gap-2">
            {[
              { value: 'plaintiff', label: '原告方' },
              { value: 'defendant', label: '被告方' },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setForm((f) => ({ ...f, client_role: opt.value }))}
                className={`flex-1 rounded border px-2.5 py-1.5 text-xs font-medium transition ${
                  form.client_role === opt.value
                    ? 'border-ac bg-ac/15 text-ac'
                    : 'border-bd text-t3 hover:border-t3 hover:text-t1'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 原告 */}
        <div>
          <label className="mb-1 block text-xs text-t2">原告</label>
          <input
            value={form.plaintiff}
            onChange={set('plaintiff')}
            placeholder="原告名稱"
            className={inputClass}
          />
        </div>

        {/* 被告 */}
        <div>
          <label className="mb-1 block text-xs text-t2">被告</label>
          <input
            value={form.defendant}
            onChange={set('defendant')}
            placeholder="被告名稱"
            className={inputClass}
          />
        </div>

        {/* AI 處理指引 */}
        <div>
          <label className="mb-1 block text-xs text-t2">AI 處理指引</label>
          <textarea
            value={form.case_instructions}
            onChange={set('case_instructions')}
            placeholder="例：本案重點在過失比例，請加強被告超速的論述..."
            className={`${inputClass} min-h-24 resize-y`}
          />
          <p className="mt-1 text-[10px] text-t3">AI 分析案件和撰寫書狀時會參考此指引</p>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-rd">{error}</p>}

      {/* 儲存按鈕 */}
      <div className="mt-4">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="flex w-full items-center justify-center gap-1.5 rounded bg-ac px-3 py-1.5 text-xs font-medium text-bg-0 transition hover:opacity-90 disabled:opacity-40"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          {saving ? '儲存中...' : '儲存'}
        </button>
      </div>
    </div>
  );
};
