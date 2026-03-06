export interface CategoryInfo {
  badge: string;
  label: string;
  badgeCls: string;
  tagCls: string;
}

/** New 5-category system: brief / exhibit_a / exhibit_b / court / other */
export const CATEGORY_CONFIG: Record<string, CategoryInfo> = {
  brief: { badge: '狀', label: '書狀', badgeCls: 'bg-ac/10 text-ac', tagCls: 'bg-ac/20 text-ac' },
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
  court: { badge: '法', label: '法院', badgeCls: 'bg-pu/10 text-pu', tagCls: 'bg-pu/20 text-pu' },
  other: { badge: '他', label: '其他', badgeCls: 'bg-bg-3 text-t3', tagCls: 'bg-bg-4 text-t3' },
};

/** Category keys shown in the picker (excludes legacy keys) */
export const SELECTABLE_CATEGORIES = ['brief', 'exhibit_a', 'exhibit_b', 'court', 'other'] as const;

export const getCategoryTagCls = (category: string | null): string =>
  CATEGORY_CONFIG[category || 'other']?.tagCls ?? CATEGORY_CONFIG.other.tagCls;

export const getCategoryLabel = (category: string | null): string =>
  CATEGORY_CONFIG[category || 'other']?.label ?? '其他';
