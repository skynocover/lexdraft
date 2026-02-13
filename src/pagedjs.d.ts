declare module 'pagedjs' {
  export class Previewer {
    preview(
      content: string,
      stylesheets: Array<{ text: string } | { url: string }>,
      renderTo: HTMLElement,
    ): Promise<{ total?: number; pages?: unknown[] }>
  }
}
