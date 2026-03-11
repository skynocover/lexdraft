## Chat Context Awareness

### Requirements

1. `useChatStore.sendMessage()` 的 `briefContext` 改從 `briefCache[activeBriefId]` 讀取（而非 `currentBrief`）
2. `requestBody` 新增 `allBriefs` 欄位：`briefs.map(b => ({ id: b.id, title: b.title, template_id: b.template_id }))`
3. `AgentDO.ts` system prompt 新增已有書狀列表，格式：「案件已有的書狀：{title} ({template_id}, brief_id: {id})」
4. `src/shared/types.ts` 的 `ChatRequest` type 新增 `allBriefs?` 欄位

### Constraints

- `briefContext` 只送 active brief 的段落摘要（現有行為不變）
- `allBriefs` 只送 metadata，不送 content（避免 token 浪費）
- 後端 `chat.ts` route 需接收並傳遞 `allBriefs` 到 AgentDO

### Acceptance Criteria

- 案件有起訴狀 + 答辯狀 → chat message 帶 `allBriefs: [{...起訴狀}, {...答辯狀}]`
- Agent system prompt 可見兩份書狀的標題和 template_id
