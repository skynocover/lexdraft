import { FILE_CATEGORY_VALUES, type FileCategoryValue } from '../../shared/caseConstants';

export interface CategoryInfo {
  badge: string;
  label: string;
  badgeCls: string;
  tagCls: string;
}

/** 6-category system: brief_theirs / exhibit_a / exhibit_b / judgment / court / other */
export const CATEGORY_CONFIG: Record<string, CategoryInfo> = {
  brief_theirs: {
    badge: '對',
    label: '對方書狀',
    badgeCls: 'bg-rd/10 text-rd',
    tagCls: 'bg-rd/20 text-rd',
  },
  exhibit_a: {
    badge: '甲',
    label: '甲方證物',
    badgeCls: 'bg-or/10 text-or',
    tagCls: 'bg-or/20 text-or',
  },
  exhibit_b: {
    badge: '乙',
    label: '乙方證物',
    badgeCls: 'bg-rd/10 text-rd',
    tagCls: 'bg-rd/20 text-rd',
  },
  judgment: {
    badge: '判',
    label: '判決',
    badgeCls: 'bg-pu/10 text-pu',
    tagCls: 'bg-pu/20 text-pu',
  },
  court: {
    badge: '法',
    label: '法院文件',
    badgeCls: 'bg-pu/10 text-pu',
    tagCls: 'bg-pu/20 text-pu',
  },
  other: { badge: '他', label: '其他', badgeCls: 'bg-bg-3 text-t3', tagCls: 'bg-bg-4 text-t3' },
};
// Legacy fallback — 舊檔案 category='brief' 顯示為對方書狀
CATEGORY_CONFIG.brief = CATEGORY_CONFIG.brief_theirs;

/** All user-selectable file categories (canonical values, no legacy aliases) */
export const SELECTABLE_CATEGORIES: readonly FileCategoryValue[] = FILE_CATEGORY_VALUES;

export const getCategoryTagCls = (category: string | null): string =>
  CATEGORY_CONFIG[category || 'other']?.tagCls ?? CATEGORY_CONFIG.other.tagCls;

export const getCategoryLabel = (category: string | null): string =>
  CATEGORY_CONFIG[category || 'other']?.label ?? '其他';
