## 1. 前端分類配置

- [x] 1.1 更新 `categoryConfig.ts`：新增 brief/exhibit_a/exhibit_b 定義，保留 ours/theirs/evidence 作為 legacy fallback
- [x] 1.2 更新 `FileItem.tsx` category popover：只顯示新五類（brief/exhibit_a/exhibit_b/court/other）供選擇

## 2. 後端 AI 分類

- [x] 2.1 更新 `fileProcessor.ts` CLASSIFY_PROMPT：改為 brief/exhibit_a/exhibit_b/court/other 五類，加入 client_role 資訊
- [x] 2.2 更新 `fileProcessor.ts` 分類流程：從 cases 表取得 client_role 傳入 prompt
- [x] 2.3 更新 `fallbackClassify`：檔名分類邏輯改用新 category key

## 3. 後端 Exhibit 映射

- [x] 3.1 簡化 `exhibitAssign.ts` 的 `getExhibitPrefix`：exhibit_a→甲證, exhibit_b→乙證，移除 client_role 參數
- [x] 3.2 更新 `files.ts` PUT handler：category→prefix 連動邏輯改用新 key，移除 client_role 查詢

## 4. 前端分組顯示

- [x] 4.1 更新 `FilesSection.tsx` groupFiles：用新 category key 判斷分組（exhibit_a/exhibit_b + legacy ours/theirs/evidence fallback）
