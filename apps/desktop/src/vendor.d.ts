declare module 'turndown' {
  export interface Options {
    bulletListMarker?: '-' | '*';
    codeBlockStyle?: 'indented' | 'fenced';
    headingStyle?: 'setext' | 'atx';
  }

  export default class TurndownService {
    constructor(options?: Options);
    use(plugin: unknown): void;
    turndown(input: string): string;
  }
}

declare module 'turndown-plugin-gfm' {
  export const gfm: unknown;
}
