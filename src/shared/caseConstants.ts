export const COURTS = [
  '最高法院',
  '最高行政法院',
  '憲法法庭',
  '懲戒法院',
  '臺灣高等法院',
  '臺灣高等法院臺中分院',
  '臺灣高等法院臺南分院',
  '臺灣高等法院高雄分院',
  '臺灣高等法院花蓮分院',
  '福建高等法院金門分院',
  '臺北高等行政法院',
  '臺中高等行政法院',
  '高雄高等行政法院',
  '臺灣臺北地方法院',
  '臺灣新北地方法院',
  '臺灣士林地方法院',
  '臺灣桃園地方法院',
  '臺灣新竹地方法院',
  '臺灣苗栗地方法院',
  '臺灣臺中地方法院',
  '臺灣南投地方法院',
  '臺灣彰化地方法院',
  '臺灣雲林地方法院',
  '臺灣嘉義地方法院',
  '臺灣臺南地方法院',
  '臺灣高雄地方法院',
  '臺灣橋頭地方法院',
  '臺灣屏東地方法院',
  '臺灣臺東地方法院',
  '臺灣花蓮地方法院',
  '臺灣宜蘭地方法院',
  '臺灣基隆地方法院',
  '臺灣澎湖地方法院',
  '福建金門地方法院',
  '福建連江地方法院',
  '智慧財產及商業法院',
  '臺灣高雄少年及家事法院',
] as const;

export const DIVISIONS = ['民事庭', '刑事庭', '簡易庭', '家事庭', '行政訴訟庭'] as const;

export const CLIENT_ROLES = ['plaintiff', 'defendant'] as const;
export type ClientRole = (typeof CLIENT_ROLES)[number];

export const DEFAULT_BRIEF_LABEL = '書狀';

/** 書狀論述模式選項（前端 Dialog / TemplateEditor 共用） */
export const BRIEF_MODE_OPTIONS = [
  {
    value: 'claim',
    label: '提出請求',
    example: '起訴、反訴等',
    description: 'AI 會以主動建立請求權基礎的策略撰寫此書狀',
  },
  {
    value: 'defense',
    label: '回應對方',
    example: '答辯等',
    description: 'AI 會以逐點反駁對方主張的策略撰寫此書狀',
  },
  {
    value: 'supplement',
    label: '補充攻防',
    example: '準備書狀等',
    description: 'AI 會根據案件立場，以回應前一輪攻防的策略撰寫此書狀',
  },
  {
    value: 'challenge',
    label: '挑戰裁判',
    example: '上訴等',
    description: 'AI 會以指出原判決錯誤的策略撰寫此書狀',
  },
  {
    value: 'petition',
    label: '聲請法院',
    example: '強制執行等',
    description: 'AI 會以陳述事實並聲請裁定的策略撰寫此書狀',
  },
] as const;

/** Zod-friendly tuple: declared as const for type-safe z.enum() usage */
export const BRIEF_MODE_VALUES = [
  'claim',
  'defense',
  'supplement',
  'challenge',
  'petition',
] as const;
export type BriefModeValue = (typeof BRIEF_MODE_VALUES)[number];

/** 檔案分類值（6 類 + legacy 'brief' alias） */
export const FILE_CATEGORY_VALUES = [
  'brief_theirs',
  'exhibit_a',
  'exhibit_b',
  'judgment',
  'court',
  'other',
] as const;
export type FileCategoryValue = (typeof FILE_CATEGORY_VALUES)[number];
