import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs/promises';
import { buildDependencyGraph, traceImpact } from '../../../core/src/impact/graph.js';
import { IMPACT_SCORES } from '../../../core/src/impact/types.js';

vi.mock('fs/promises');

describe('Impact Graph', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('buildDependencyGraph', () => {
    it('should build a graph tracking dependents and imports', async () => {
      const files = ['a.ts', 'b.ts', 'c.ts'];
      
      const mockFiles: Record<string, string> = {
        'a.ts': `export const a = 1;`,
        'b.ts': `import { a } from './a'; export const b = 2;`,
        'c.ts': `import { b } from './b'; import { a } from './a'; export const c = 3;`,
      };

      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        const name = filePath.toString().split('/').pop() || '';
        if (mockFiles[name]) return mockFiles[name];
        throw new Error('Not found');
      });

      const graph = await buildDependencyGraph(files, '/mock');

      // 'a.ts' should have dependents 'b.ts' and 'c.ts'
      expect(graph.dependents.get('a.ts')).toBeDefined();
      expect(graph.dependents.get('a.ts')?.has('b.ts')).toBe(true);
      expect(graph.dependents.get('a.ts')?.has('c.ts')).toBe(true);

      // 'b.ts' should have dependent 'c.ts'
      expect(graph.dependents.get('b.ts')).toBeDefined();
      expect(graph.dependents.get('b.ts')?.has('c.ts')).toBe(true);

      // Check imports tracking
      const importsForB = graph.imports.get('b.ts');
      expect(importsForB?.get('a.ts')?.has('a')).toBe(true);
    });
  });

  describe('traceImpact', () => {
    it('should trace transitive impact with correct scoring and deduplication', () => {
      const graph = {
        dependents: new Map([
          ['changed.ts', new Set(['direct.ts'])],
          ['direct.ts', new Set(['second.ts', 'multiple-path.ts'])],
          ['second.ts', new Set(['third.ts', 'multiple-path.ts'])],
          ['third.ts', new Set(['fourth.ts'])],
        ]),
        exports: new Map(),
        imports: new Map([
          ['direct.ts', new Map([['changed.ts', new Set(['sym1'])]])]
        ]),
      };

      const result = traceImpact(['changed.ts'], graph, 10);

      // We expect 5 impacted files: direct, second, third, multiple-path, fourth
      expect(result.length).toBe(5);

      const direct = result.find(r => r.file === 'direct.ts');
      expect(direct?.proximity).toBe(1);
      expect(direct?.relevanceScore).toBe(IMPACT_SCORES.DIRECT);
      expect(direct?.importedSymbols).toEqual(['sym1']);

      const second = result.find(r => r.file === 'second.ts');
      expect(second?.proximity).toBe(2);
      expect(second?.relevanceScore).toBe(IMPACT_SCORES.SECOND_DEGREE);

      // multiple-path.ts is reachable at distance 2 (changed -> direct -> multiple-path) 
      // and distance 3 (changed -> direct -> second -> multiple-path)
      // Deduplication should keep the highest score (distance 2)
      const multi = result.find(r => r.file === 'multiple-path.ts');
      expect(multi?.proximity).toBe(2);
      expect(multi?.relevanceScore).toBe(IMPACT_SCORES.SECOND_DEGREE);

      const fourth = result.find(r => r.file === 'fourth.ts');
      expect(fourth?.proximity).toBe(4);
      expect(fourth?.relevanceScore).toBe(IMPACT_SCORES.THIRD_DEGREE * IMPACT_SCORES.DIMINISHING_FACTOR);
    });

    it('should respect depth threshold', () => {
      const graph = {
        dependents: new Map([
          ['changed.ts', new Set(['level1.ts'])],
          ['level1.ts', new Set(['level2.ts'])],
          ['level2.ts', new Set(['level3.ts'])],
        ]),
        exports: new Map(),
        imports: new Map(),
      };

      // Set threshold to 1
      const result = traceImpact(['changed.ts'], graph, 1);

      // Should only include level1.ts
      expect(result.length).toBe(1);
      expect(result[0].file).toBe('level1.ts');
    });
  });
});
