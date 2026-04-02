import { useState, useEffect, useMemo } from 'react';
import { useCaseStore } from '../../../stores/useCaseStore';
import { useTemplateStore, type TemplateSummary } from '../../../stores/useTemplateStore';
import { useTabStore } from '../../../stores/useTabStore';
import { Loader2, ExternalLink, Plus, Sparkles } from 'lucide-react';
import { NewTemplateDialog } from './NewTemplateDialog';
import type { BriefModeValue } from '../../../../shared/caseConstants';
import { COURTS, DIVISIONS } from '../../../lib/caseConstants';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';

interface FormData {
  title: string;
  case_number: string;
  court: string;
  division: string;
  template_id: string;
  client_role: string;
  plaintiff: string;
  defendant: string;
  case_instructions: string;
}

const DEFAULT_DIVISION = DIVISIONS[0];
/** 預設值：新案件預設 AI 自動選擇 */
const DEFAULT_TEMPLATE_ID = 'auto';
/** 表單值：不使用範本（DB 中為 null） */
const NONE_TEMPLATE_ID = 'none';

/** DB template_id → form value */
const toFormTemplateId = (dbValue: string | null | undefined): string =>
  dbValue === null ? NONE_TEMPLATE_ID : dbValue || DEFAULT_TEMPLATE_ID;

/** form value → DB template_id */
const fromFormTemplateId = (formValue: string): string | null =>
  formValue === NONE_TEMPLATE_ID ? null : formValue || null;

export const CaseInfoTab = () => {
  const currentCase = useCaseStore((s) => s.currentCase);
  const isDemo = useCaseStore((s) => s.isDemo);
  const updateCase = useCaseStore((s) => s.updateCase);
  const templates = useTemplateStore((s) => s.templates);
  const loadTemplates = useTemplateStore((s) => s.loadTemplates);
  const createTemplate = useTemplateStore((s) => s.createTemplate);
  const openTemplateTab = useTabStore((s) => s.openTemplateTab);

  const [form, setForm] = useState<FormData>({
    title: '',
    case_number: '',
    court: '',
    division: DEFAULT_DIVISION,
    template_id: DEFAULT_TEMPLATE_ID,
    client_role: '',
    plaintiff: '',
    defendant: '',
    case_instructions: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [newTplOpen, setNewTplOpen] = useState(false);

  // 載入範本列表
  useEffect(() => {
    if (templates.length === 0) {
      loadTemplates();
    }
  }, [templates.length, loadTemplates]);

  useEffect(() => {
    if (currentCase) {
      setForm({
        title: currentCase.title || '',
        case_number: currentCase.case_number || '',
        court: currentCase.court || '',
        division: currentCase.division || '民事庭',
        template_id: toFormTemplateId(currentCase.template_id),
        client_role: currentCase.client_role || '',
        plaintiff: currentCase.plaintiff || '',
        defendant: currentCase.defendant || '',
        case_instructions: currentCase.case_instructions || '',
      });
    }
  }, [currentCase]);

  const dirty = useMemo(() => {
    if (!currentCase) return false;
    const currentTemplateId = toFormTemplateId(currentCase.template_id);
    return (
      form.title !== (currentCase.title || '') ||
      form.case_number !== (currentCase.case_number || '') ||
      form.court !== (currentCase.court || '') ||
      form.division !== (currentCase.division || DEFAULT_DIVISION) ||
      form.template_id !== currentTemplateId ||
      form.client_role !== (currentCase.client_role || '') ||
      form.plaintiff !== (currentCase.plaintiff || '') ||
      form.defendant !== (currentCase.defendant || '') ||
      form.case_instructions !== (currentCase.case_instructions || '')
    );
  }, [form, currentCase]);

  // 範本分組：自訂 vs 系統預設
  const { customTemplates, defaultTemplates } = useMemo(() => {
    const custom: TemplateSummary[] = [];
    const defaults: TemplateSummary[] = [];

    for (const t of templates) {
      if (t.is_default === 1) {
        defaults.push(t);
      } else {
        custom.push(t);
      }
    }

    return { customTemplates: custom, defaultTemplates: defaults };
  }, [templates]);

  const set =
    (key: keyof FormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleTemplateChange = (value: string) => {
    setForm((f) => ({ ...f, template_id: value }));

    // 立即儲存 template_id
    if (currentCase) {
      updateCase(currentCase.id, {
        template_id: fromFormTemplateId(value),
      });
    }
  };

  const handlePreviewTemplate = () => {
    if (
      !form.template_id ||
      form.template_id === DEFAULT_TEMPLATE_ID ||
      form.template_id === NONE_TEMPLATE_ID
    )
      return;
    const tpl = templates.find((t) => t.id === form.template_id);
    if (tpl) {
      openTemplateTab(tpl.id, tpl.title);
    }
  };

  const handleCreateTemplate = async (title: string, briefMode: BriefModeValue) => {
    const tpl = await createTemplate(title, briefMode);
    openTemplateTab(tpl.id, tpl.title);
  };

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
        division: form.division.trim() || null,
        template_id: fromFormTemplateId(form.template_id),
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

  const showPreview =
    form.template_id &&
    form.template_id !== DEFAULT_TEMPLATE_ID &&
    form.template_id !== NONE_TEMPLATE_ID;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-3">
      <div className="space-y-4">
        {/* ── 案件資訊 ── */}
        <div className="space-y-2.5">
          <h3 className="text-xs font-medium text-t2">案件資訊</h3>

          {/* 案件名稱 */}
          <div>
            <label className="mb-1 block text-[11px] text-t3">
              案件名稱 <span className="text-rd">*</span>
            </label>
            <input
              value={form.title}
              onChange={set('title')}
              placeholder="案件名稱"
              disabled={isDemo}
              className={inputClass}
            />
          </div>

          {/* 案號 (full width) */}
          <div>
            <label className="mb-1 block text-[11px] text-t3">案號</label>
            <input
              value={form.case_number}
              onChange={set('case_number')}
              placeholder="114年度雄簡字第○○號"
              disabled={isDemo}
              className={inputClass}
            />
          </div>

          {/* 法院 + 庭別 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] text-t3">法院</label>
              <Select
                value={form.court || '__none__'}
                onValueChange={(v) => setForm((f) => ({ ...f, court: v === '__none__' ? '' : v }))}
                disabled={isDemo}
              >
                <SelectTrigger className={inputClass}>
                  <SelectValue placeholder="請選擇" />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-72">
                  <SelectItem value="__none__" className="text-t3">
                    請選擇
                  </SelectItem>
                  <SelectSeparator />
                  {COURTS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-t3">庭別</label>
              <Select
                value={form.division}
                onValueChange={(v) => setForm((f) => ({ ...f, division: v }))}
                disabled={isDemo}
              >
                <SelectTrigger className={inputClass}>
                  <SelectValue placeholder="民事庭" />
                </SelectTrigger>
                <SelectContent position="popper">
                  {DIVISIONS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* ── 當事人 ── */}
        <div className="space-y-2.5">
          <h3 className="text-xs font-medium text-t2">當事人（我方立場）</h3>

          <div className="flex gap-2">
            {[
              {
                value: 'plaintiff',
                label: '原告方',
                field: 'plaintiff' as const,
                placeholder: '原告名稱',
              },
              {
                value: 'defendant',
                label: '被告方',
                field: 'defendant' as const,
                placeholder: '被告名稱',
              },
            ].map((opt) => (
              <div key={opt.value} className="flex flex-1 flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, client_role: opt.value }))}
                  disabled={isDemo}
                  className={`w-full rounded border px-2.5 py-1.5 text-xs font-medium transition ${
                    form.client_role === opt.value
                      ? 'border-ac bg-ac/15 text-ac'
                      : 'border-bd text-t3 hover:border-t3 hover:text-t1'
                  }`}
                >
                  {opt.label}
                </button>
                <input
                  value={form[opt.field]}
                  onChange={set(opt.field)}
                  placeholder={opt.placeholder}
                  disabled={isDemo}
                  className={inputClass}
                />
              </div>
            ))}
          </div>
        </div>

        {/* ── AI 設定 ── */}
        <div className="space-y-2.5">
          <h3 className="text-xs font-medium text-t2">AI 設定</h3>

          {/* 書狀範本 */}
          <div>
            <label className="mb-1 block text-[11px] text-t3">書狀範本</label>
            <Select
              value={form.template_id || DEFAULT_TEMPLATE_ID}
              onValueChange={handleTemplateChange}
              disabled={isDemo}
            >
              <SelectTrigger className={inputClass}>
                <SelectValue placeholder="AI 自動選擇" />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-72">
                <SelectItem value="auto">
                  <span className="flex items-center gap-1.5">
                    <Sparkles size={12} className="text-ac" />
                    <span>AI 自動選擇</span>
                  </span>
                </SelectItem>
                <SelectItem value="none">不使用範本</SelectItem>
                <SelectSeparator />

                {/* 我的範本 */}
                {customTemplates.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>我的範本</SelectLabel>
                    {customTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.title}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}

                {/* 系統範本 */}
                {defaultTemplates.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>系統範本</SelectLabel>
                    {defaultTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.title}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
            <div className="mt-1 flex items-center gap-2">
              {form.template_id === DEFAULT_TEMPLATE_ID && (
                <p className="text-[10px] text-t3">AI 會根據書狀類型自動選擇最合適的範本</p>
              )}
              {showPreview && (
                <button
                  onClick={handlePreviewTemplate}
                  className="flex items-center gap-1 text-[10px] text-ac transition hover:underline"
                >
                  <span>點擊預覽</span>
                  <ExternalLink size={10} />
                </button>
              )}
            </div>
            {/* 新增自訂範本 */}
            <button
              onClick={() => setNewTplOpen(true)}
              disabled={isDemo}
              className="mt-1.5 flex w-full items-center justify-center gap-1 rounded border border-dashed border-bd py-1.5 text-[11px] text-t3 transition hover:border-ac hover:text-ac disabled:opacity-40"
            >
              <Plus size={12} />
              <span>新增自訂範本</span>
            </button>
            <NewTemplateDialog
              open={newTplOpen}
              onOpenChange={setNewTplOpen}
              onCreate={handleCreateTemplate}
            />
          </div>

          {/* AI 處理指引 */}
          <div>
            <label className="mb-1 block text-[11px] text-t3">AI 處理指引</label>
            <textarea
              value={form.case_instructions}
              onChange={set('case_instructions')}
              placeholder="例：本案重點在過失比例，請加強被告超速的論述..."
              disabled={isDemo}
              className={`${inputClass} min-h-24 resize-y`}
            />
            <p className="mt-1 text-[10px] text-t3">AI 分析案件和撰寫書狀時會參考此指引</p>
          </div>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-rd">{error}</p>}

      {/* 儲存按鈕 */}
      <div className="mt-4">
        <button
          onClick={handleSave}
          disabled={!dirty || saving || isDemo}
          className="flex w-full items-center justify-center gap-1.5 rounded bg-ac px-3 py-1.5 text-xs font-medium text-bg-0 transition hover:opacity-90 disabled:opacity-40"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          {saving ? '儲存中...' : '儲存'}
        </button>
      </div>
    </div>
  );
};
