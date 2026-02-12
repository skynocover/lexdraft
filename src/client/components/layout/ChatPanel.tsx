export function ChatPanel() {
  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-bd bg-bg-1">
      {/* 聊天訊息區 */}
      <div className="flex flex-1 flex-col overflow-y-auto p-3">
        <div className="flex flex-1 items-center justify-center">
          <p className="text-center text-xs text-t3">
            在下方輸入指令開始對話
          </p>
        </div>
      </div>

      {/* 輸入框 */}
      <div className="border-t border-bd p-3">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="輸入指令..."
            className="flex-1 rounded border border-bd bg-bg-3 px-3 py-2 text-sm text-t1 outline-none placeholder:text-t3 focus:border-ac"
            disabled
          />
          <button
            className="rounded bg-ac px-3 py-2 text-sm font-medium text-bg-0 opacity-50"
            disabled
          >
            送出
          </button>
        </div>
      </div>
    </aside>
  )
}
