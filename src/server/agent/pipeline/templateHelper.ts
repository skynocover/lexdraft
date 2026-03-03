/** 將範本 markdown 包裝為 prompt 注入文字 */
export const templateToPrompt = (contentMd: string): string => {
  return `\n═══ 律師指定的書狀範本 ═══
以下是律師為本案指定的範本，請依照此範本的格式、結構與慣例撰寫書狀。
其他未指定的事項仍依上方預設慣例。
如有本範本未涵蓋的重要事項，得在範本結構之後補充新增段落。

${contentMd}`;
};
