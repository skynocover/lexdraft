## 1. DisputesTab 改善

- [x] 1.1 DisputeCard 加上爭點編號前綴：從 DisputesTab 傳入 index，顯示「爭點 {index+1}：{title}」
- [x] 1.2 Summary bar 零值隱藏：將「充分/不足/缺漏」改為 count > 0 時才渲染
- [x] 1.3 DisputeCard 展開/收合 icon：將 `▾`/`▸` 替換為 ChevronRight + rotate-90 transition

## 2. DamageCard 改善

- [x] 2.1 DamageCard 展開/收合 icon：將 `▾`/`▸` 替換為 ChevronRight + rotate-90 transition

## 3. 驗證

- [x] 3.1 npx tsc --noEmit 通過
- [x] 3.2 Prettier format
