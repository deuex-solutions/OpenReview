import path from 'path';

import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import Python from 'tree-sitter-python';
import TypeScript from 'tree-sitter-typescript';

/**
 * Information about a detected import.
 */
export interface ImportInfo {
  source: string;
  symbols: string[];
  isDynamic: boolean;
}

/**
 * Information about a detected export.
 */
export interface ExportInfo {
  symbols: string[];
}

/**
 * Maps file extensions to Tree-sitter languages.
 */
const LANGUAGE_MAP: Record<string, unknown> = {
  '.ts': TypeScript.typescript,
  '.tsx': TypeScript.tsx,
  '.js': JavaScript,
  '.jsx': JavaScript,
  '.mjs': JavaScript,
  '.cjs': JavaScript,
  '.py': Python,
};

/**
 * Detects the Tree-sitter language based on file extension.
 */
export function detectLanguage(filePath: string): unknown | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGE_MAP[ext];
}

/**
 * Extracts imports from a source file using Tree-sitter.
 */
export function extractImports(filePath: string, content: string): ImportInfo[] {
  const lang = detectLanguage(filePath);
  if (!lang) return [];

  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(content);

  const imports: ImportInfo[] = [];
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.py') {
    extractPythonImports(tree.rootNode, imports);
  } else {
    extractJSImports(tree.rootNode, imports);
  }

  return imports;
}

/**
 * Extracts exports from a source file using Tree-sitter.
 */
export function extractExports(filePath: string, content: string): ExportInfo {
  const lang = detectLanguage(filePath);
  if (!lang) return { symbols: [] };

  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(content);

  const symbols: string[] = [];
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.py') {
    extractPythonExports(tree.rootNode, symbols);
  } else {
    extractJSExports(tree.rootNode, symbols);
  }

  return { symbols };
}

function extractJSImports(node: Parser.SyntaxNode, results: ImportInfo[]) {
  const query = new Parser.Query(
    node.tree.language,
    `
      (import_statement
        source: (string (string_fragment) @source))
      
      (import_statement
        (import_clause
          (named_imports
            (import_specifier
              name: (identifier) @symbol)))
        source: (string (string_fragment) @source))

      (import_statement
        (import_clause
          (identifier) @symbol)
        source: (string (string_fragment) @source))

      (call_expression
        function: (identifier) @func
        arguments: (arguments (string (string_fragment) @source))
        (#eq? @func "require"))
    `
  );

  const matches = query.matches(node);
  const importMap = new Map<string, Set<string>>();

  for (const match of matches) {
    let source = '';
    let symbol = '';

    for (const capture of match.captures) {
      if (capture.name === 'source') {
        source = capture.node.text;
      } else if (capture.name === 'symbol') {
        symbol = capture.node.text;
      }
    }

    if (source) {
      if (!importMap.has(source)) {
        importMap.set(source, new Set());
      }
      if (symbol) {
        importMap.get(source)!.add(symbol);
      }
    }
  }

  for (const [source, symbols] of importMap.entries()) {
    results.push({
      source,
      symbols: Array.from(symbols),
      isDynamic: false,
    });
  }
}

function extractJSExports(node: Parser.SyntaxNode, symbols: string[]) {
  // Manual traversal for reliability across grammar versions
  for (const child of node.children) {
    if (child.type === 'export_statement') {
      for (const grandChild of child.children) {
        if (['function_declaration', 'class_declaration'].includes(grandChild.type)) {
          const id = grandChild.children.find((n: Parser.SyntaxNode) => n.type === 'identifier' || n.type === 'type_identifier');
          if (id) symbols.push(id.text);
        } else if (['variable_declaration', 'lexical_declaration'].includes(grandChild.type)) {
          for (const declarator of grandChild.children) {
            if (declarator.type === 'variable_declarator') {
              const id = declarator.children.find((n: Parser.SyntaxNode) => n.type === 'identifier' || n.type === 'type_identifier');
              if (id) symbols.push(id.text);
            }
          }
        } else if (grandChild.type === 'export_clause') {
          for (const specifier of grandChild.children) {
            if (specifier.type === 'export_specifier') {
              const id = specifier.children.find((n: Parser.SyntaxNode) => n.type === 'identifier' || n.type === 'type_identifier');
              if (id) symbols.push(id.text);
            }
          }
        }
      }
    }
  }
}

function extractPythonImports(node: Parser.SyntaxNode, results: ImportInfo[]) {
  const importMap = new Map<string, Set<string>>();

  for (const child of node.children) {
    if (child.type === 'import_from_statement') {
      const moduleNode = child.children.find((n: Parser.SyntaxNode) => n.type === 'dotted_name');
      if (moduleNode) {
        const source = moduleNode.text;
        if (!importMap.has(source)) importMap.set(source, new Set());
        
        // Find identifiers/dotted_names after the 'import' keyword
        let afterImport = false;
        for (const grandChild of child.children) {
          if (grandChild.type === 'import') afterImport = true;
          if (afterImport && (grandChild.type === 'dotted_name' || grandChild.type === 'identifier')) {
            importMap.get(source)!.add(grandChild.text);
          } else if (afterImport && grandChild.type === 'aliased_import') {
             const id = grandChild.children.find((n: Parser.SyntaxNode) => n.type === 'identifier' || n.type === 'dotted_name');
             if (id) importMap.get(source)!.add(id.text);
          }
        }
      }
    } else if (child.type === 'import_statement') {
      for (const grandChild of child.children) {
        if (grandChild.type === 'dotted_name') {
          const source = grandChild.text;
          if (!importMap.has(source)) importMap.set(source, new Set());
        } else if (grandChild.type === 'aliased_import') {
          const moduleNode = grandChild.children.find((n: Parser.SyntaxNode) => n.type === 'dotted_name');
          if (moduleNode) {
            const source = moduleNode.text;
            if (!importMap.has(source)) importMap.set(source, new Set());
          }
        }
      }
    }
  }

  for (const [source, symbols] of importMap.entries()) {
    results.push({
      source,
      symbols: Array.from(symbols),
      isDynamic: false,
    });
  }
}

function extractPythonExports(node: Parser.SyntaxNode, symbols: string[]) {
  for (const child of node.children) {
    if (child.type === 'function_definition' || child.type === 'class_definition') {
      const id = child.children.find((n: Parser.SyntaxNode) => n.type === 'identifier');
      if (id) symbols.push(id.text);
    } else if (child.type === 'expression_statement') {
      const assignment = child.children.find((n: Parser.SyntaxNode) => n.type === 'assignment');
      if (assignment) {
        const left = assignment.children.find((n: Parser.SyntaxNode) => n.type === 'identifier');
        if (left) symbols.push(left.text);
      }
    }
  }
}
