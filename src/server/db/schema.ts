import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// 3.0 users — 用戶
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  name: text('name'),
  created_at: text('created_at'),
  updated_at: text('updated_at'),
});

// 3.1 cases — 案件
export const cases = sqliteTable('cases', {
  id: text('id').primaryKey(),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
  case_number: text('case_number'),
  court: text('court'),
  case_type: text('case_type'),
  plaintiff: text('plaintiff'),
  defendant: text('defendant'),
  law_refs: text('law_refs'),
  timeline: text('timeline'), // JSON array of timeline events
  created_at: text('created_at'),
  updated_at: text('updated_at'),
});

// 3.2 files — 案件卷宗檔案
export const files = sqliteTable('files', {
  id: text('id').primaryKey(),
  case_id: text('case_id')
    .notNull()
    .references(() => cases.id),
  filename: text('filename').notNull(),
  r2_key: text('r2_key').notNull(),
  file_size: integer('file_size'),
  mime_type: text('mime_type'),

  // AI 處理結果
  status: text('status').default('pending'), // pending | processing | ready | error
  category: text('category'), // ours | theirs | court | evidence | other
  doc_type: text('doc_type'), // complaint | defense | preparation | transcript | ruling | notice | evidence | other
  doc_date: text('doc_date'),
  full_text: text('full_text'),
  content_md: text('content_md'), // AI-generated markdown (for citation chunking)
  summary: text('summary'), // JSON
  extracted_claims: text('extracted_claims'), // JSON array

  created_at: text('created_at'),
  updated_at: text('updated_at'),
});

// 3.3 briefs — 書狀
export const briefs = sqliteTable('briefs', {
  id: text('id').primaryKey(),
  case_id: text('case_id')
    .notNull()
    .references(() => cases.id),
  brief_type: text('brief_type').notNull(), // complaint | defense | preparation | appeal
  title: text('title'),
  content_structured: text('content_structured'), // JSON — 唯一 source of truth
  version: integer('version').default(1),
  created_at: text('created_at'),
  updated_at: text('updated_at'),
});

// 3.3.1 brief_versions — 書狀版本紀錄
export const briefVersions = sqliteTable('brief_versions', {
  id: text('id').primaryKey(),
  brief_id: text('brief_id')
    .notNull()
    .references(() => briefs.id),
  version_no: integer('version_no').notNull(),
  label: text('label').notNull(),
  content_structured: text('content_structured').notNull(),
  created_at: text('created_at').notNull(),
  created_by: text('created_by').notNull(), // 'user' | 'ai' | 'system'
});

// 3.4 disputes — 爭點
export const disputes = sqliteTable('disputes', {
  id: text('id').primaryKey(),
  case_id: text('case_id')
    .notNull()
    .references(() => cases.id),
  brief_id: text('brief_id').references(() => briefs.id),
  number: integer('number'),
  title: text('title'),
  our_position: text('our_position'),
  their_position: text('their_position'),
  evidence: text('evidence'), // JSON array
  law_refs: text('law_refs'), // JSON array
  priority: integer('priority').default(0),
});

// 3.5 damages — 金額計算
export const damages = sqliteTable('damages', {
  id: text('id').primaryKey(),
  case_id: text('case_id')
    .notNull()
    .references(() => cases.id),
  category: text('category').notNull(), // 貨款、利息、違約金、精神慰撫金 等
  description: text('description'), // 明細說明
  amount: integer('amount').notNull(), // 金額（整數，以新台幣元計）
  basis: text('basis'), // 計算依據
  evidence_refs: text('evidence_refs'), // JSON array — 引用的證據檔案
  dispute_id: text('dispute_id').references(() => disputes.id), // 可選：關聯爭點
  created_at: text('created_at'),
});

// 3.6 claims — 主張圖譜
export const claims = sqliteTable('claims', {
  id: text('id').primaryKey(),
  case_id: text('case_id')
    .notNull()
    .references(() => cases.id),
  side: text('side').notNull(), // ours | theirs
  claim_type: text('claim_type').notNull(), // primary | rebuttal | supporting
  statement: text('statement').notNull(),
  assigned_section: text('assigned_section'),
  dispute_id: text('dispute_id').references(() => disputes.id),
  responds_to: text('responds_to'),
  created_at: text('created_at'),
});

// 3.7 messages — 聊天記錄
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  case_id: text('case_id')
    .notNull()
    .references(() => cases.id),
  role: text('role').notNull(), // user | assistant | tool_call | tool_result
  content: text('content').notNull(),
  metadata: text('metadata'), // JSON
  created_at: text('created_at'),
});
