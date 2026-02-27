const getToolLabel = (
  toolName: string,
  args: Record<string, unknown> | undefined,
  fullResult: string | undefined,
  status: string,
): string => {
  if (toolName === 'list_files') {
    if (status === 'running') return '正在讀取檔案清單...';
    if (fullResult) {
      try {
        const files = JSON.parse(fullResult);
        if (Array.isArray(files)) return `list_files — ${files.length} 個檔案`;
      } catch {
        /* ignore */
      }
    }
    return 'list_files';
  }

  if (toolName === 'read_file') {
    if (status === 'running') return '正在讀取檔案...';
    if (fullResult) {
      const match = fullResult.match(/檔案：(.+?)\n/);
      if (match) return `read_file — ${match[1]}`;
    }
    if (args?.file_id) return `read_file — ${String(args.file_id).slice(0, 12)}...`;
    return 'read_file';
  }

  if (toolName === 'create_brief') {
    const title = args?.title as string | undefined;
    if (status === 'running') return `正在建立書狀...`;
    return `已建立書狀「${title || '書狀'}」`;
  }

  if (toolName === 'write_brief_section') {
    const section = args?.section as string | undefined;
    const subsection = args?.subsection as string | undefined;
    const label = subsection || section || '段落';
    if (status === 'running') return `正在撰寫 ${label}...`;
    return `已撰寫 ${label}`;
  }

  if (toolName === 'analyze_disputes') {
    if (status === 'running') return '正在分析爭點...';
    if (fullResult) {
      const match = fullResult.match(/已識別 (\d+) 個爭點/);
      if (match) return `已識別 ${match[1]} 個爭點`;
    }
    return '已分析爭點';
  }

  if (toolName === 'search_law') {
    const query = args?.query as string | undefined;
    if (status === 'running') return `正在搜尋「${query || '...'}」...`;
    if (fullResult) {
      const match = fullResult.match(/找到 (\d+) 條/);
      if (match) return `搜尋法條「${query || ''}」— 找到 ${match[1]} 條`;
    }
    return `搜尋法條「${query || ''}」`;
  }

  if (toolName === 'calculate_damages') {
    if (status === 'running') return '正在計算金額...';
    return '已計算金額';
  }

  if (toolName === 'write_full_brief') {
    if (status === 'running') return '正在撰寫完整書狀...';
    if (fullResult) {
      const match = fullResult.match(/共 (\d+) 個段落/);
      if (match) return `write_full_brief — 已完成 ${match[1]} 段`;
    }
    return 'write_full_brief';
  }

  if (toolName === 'generate_timeline') {
    if (status === 'running') return '正在分析時間軸...';
    return '已產生時間軸';
  }

  return toolName;
};

export { getToolLabel };
