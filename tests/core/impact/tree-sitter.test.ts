import { describe, it, expect } from 'vitest';

import { extractImports, extractExports } from '../../../core/src/impact/tree-sitter';

describe('Tree-sitter Parsing', () => {
  describe('TypeScript/JavaScript', () => {
    it('should extract named imports', () => {
      const code = "import { a, b } from './module';";
      const result = extractImports('test.ts', code);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('./module');
      expect(result[0].symbols).toContain('a');
      expect(result[0].symbols).toContain('b');
    });

    it('should extract default imports', () => {
      const code = "import MyDefault from 'package';";
      const result = extractImports('test.js', code);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('package');
      expect(result[0].symbols).toContain('MyDefault');
    });

    it('should extract require calls', () => {
      const code = "const mod = require('old-school');";
      const result = extractImports('test.js', code);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('old-school');
    });

    it('should extract exports', () => {
      const code = `
        export function myFunc() {}
        export class MyClass {}
        export const myVar = 1;
        export { a, b as c };
      `;
      const result = extractExports('test.ts', code);
      expect(result.symbols).toContain('myFunc');
      expect(result.symbols).toContain('MyClass');
      expect(result.symbols).toContain('myVar');
      expect(result.symbols).toContain('a');
      expect(result.symbols).toContain('b');
    });
  });

  describe('Python', () => {
    it('should extract from ... import ...', () => {
      const code = "from math import ceil, floor";
      const result = extractImports('test.py', code);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('math');
      expect(result[0].symbols).toContain('ceil');
      expect(result[0].symbols).toContain('floor');
    });

    it('should extract basic imports', () => {
      const code = "import os, sys";
      const result = extractImports('test.py', code);
      expect(result).toHaveLength(2);
      expect(result.map(r => r.source)).toContain('os');
      expect(result.map(r => r.source)).toContain('sys');
    });

    it('should extract top-level definitions as exports', () => {
      const code = `
def my_func():
    pass

class MyClass:
    pass

MY_CONST = 10

def local():
    INTERNAL = 5
      `;
      const result = extractExports('test.py', code);
      expect(result.symbols).toContain('my_func');
      expect(result.symbols).toContain('MyClass');
      expect(result.symbols).toContain('MY_CONST');
      expect(result.symbols).not.toContain('INTERNAL');
    });
  });
});
