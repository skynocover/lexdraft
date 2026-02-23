export interface BriefTypeInfo {
  badge: string;
  label: string;
}

export const BRIEF_TYPE_CONFIG: Record<string, BriefTypeInfo> = {
  complaint: { badge: '起', label: '起訴狀' },
  defense: { badge: '答', label: '答辯狀' },
  preparation: { badge: '準', label: '準備書狀' },
  appeal: { badge: '上', label: '上訴狀' },
};

export const getBriefBadge = (briefType: string): string =>
  BRIEF_TYPE_CONFIG[briefType]?.badge ?? '書';

export const getBriefLabel = (briefType: string): string =>
  BRIEF_TYPE_CONFIG[briefType]?.label ?? '書狀';
