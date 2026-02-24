export interface CategoryInfo {
  badge: string;
  label: string;
  badgeCls: string;
  tagCls: string;
}

export const CATEGORY_CONFIG: Record<string, CategoryInfo> = {
  ours: { badge: '我', label: '我方', badgeCls: 'bg-ac/10 text-ac', tagCls: 'bg-ac/20 text-ac' },
  theirs: { badge: '對', label: '對方', badgeCls: 'bg-rd/10 text-rd', tagCls: 'bg-or/20 text-or' },
  court: { badge: '法', label: '法院', badgeCls: 'bg-pu/10 text-pu', tagCls: 'bg-pu/20 text-pu' },
  evidence: {
    badge: '證',
    label: '證據',
    badgeCls: 'bg-or/10 text-or',
    tagCls: 'bg-cy/20 text-cy',
  },
  other: { badge: '他', label: '其他', badgeCls: 'bg-bg-3 text-t3', tagCls: 'bg-bg-4 text-t3' },
};

export const getCategoryTagCls = (category: string | null): string =>
  CATEGORY_CONFIG[category || 'other']?.tagCls ?? CATEGORY_CONFIG.other.tagCls;

export const getCategoryLabel = (category: string | null): string =>
  CATEGORY_CONFIG[category || 'other']?.label ?? '其他';
