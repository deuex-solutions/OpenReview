declare module 'tree-sitter' {
  export interface Tree {
    rootNode: SyntaxNode;
    language: unknown;
  }

  export interface SyntaxNode {
    type: string;
    text: string;
    childCount: number;
    children: SyntaxNode[];
    parent: SyntaxNode | null;
    child(index: number): SyntaxNode | null;
    childByFieldName(fieldName: string): SyntaxNode | null;
    tree: Tree;
  }

  export interface QueryMatch {
    captures: Array<{ name: string; node: SyntaxNode }>;
  }

  class Parser {
    setLanguage(language: unknown): void;
    parse(input: string): Tree;
  }

  namespace Parser {
    export class Query {
      constructor(language: unknown, query: string);
      matches(node: SyntaxNode): QueryMatch[];
    }
    export type SyntaxNode = import('tree-sitter').SyntaxNode;
    export type Tree = import('tree-sitter').Tree;
    export type QueryMatch = import('tree-sitter').QueryMatch;
  }

  export default Parser;
}

declare module 'tree-sitter-typescript' {
  export const typescript: unknown;
  export const tsx: unknown;
}

declare module 'tree-sitter-javascript' {
  const language: unknown;
  export default language;
}

declare module 'tree-sitter-python' {
  const language: unknown;
  export default language;
}
