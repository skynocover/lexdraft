import { useTabStore } from "../../stores/useTabStore";

export function TabBar() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const closeTab = useTabStore((s) => s.closeTab);

  if (tabs.length === 0) return null;

  return (
    <div className="flex h-9 shrink-0 items-end overflow-x-auto border-b border-bd bg-bg-2">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isBrief = tab.data.type === "brief";
        const label =
          tab.data.type === "brief"
            ? tab.data.title || "書狀"
            : tab.data.filename;

        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`group flex h-full max-w-45 items-center gap-1.5 border-r border-bd px-3 text-xs transition ${
              isActive
                ? "border-b-2 border-b-ac bg-bg-0 text-t1"
                : "text-t3 hover:bg-bg-h hover:text-t2"
            }`}
          >
            <span
              className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${
                isBrief ? "bg-ac/20 text-ac" : "bg-rd/20 text-rd"
              }`}
            >
              {isBrief ? "DOC" : "PDF"}
            </span>
            <span className="truncate">{label}</span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="ml-1 shrink-0 rounded p-0.5 text-t3 opacity-0 transition hover:bg-bg-3 hover:text-t1 group-hover:opacity-100"
            >
              ✕
            </span>
          </button>
        );
      })}
    </div>
  );
}
