import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeImpact } from '../../../core/src/impact/analyzer.js';
import * as graphModule from '../../../core/src/impact/graph.js';
import * as mapperModule from '../../../core/src/impact/component-mapper.js';
import { ImpactGraph, ImpactNode } from '../../../core/src/impact/types.js';

vi.mock('../../../core/src/impact/graph.js');
vi.mock('../../../core/src/impact/component-mapper.js');

describe('Impact Analyzer', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return empty result if disabled', async () => {
    const result = await analyzeImpact(['changed.ts'], ['changed.ts'], '/repo', { enabled: false, depthThreshold: 10 });
    
    expect(result.summary.totalImpacted).toBe(0);
    expect(graphModule.buildDependencyGraph).not.toHaveBeenCalled();
  });

  it('should orchestrate graph building, tracing, and mapping', async () => {
    const mockGraph: ImpactGraph = {
      dependents: new Map(),
      exports: new Map(),
      imports: new Map(),
    };

    const mockImpacted: ImpactNode[] = [
      {
        file: 'src/pages/Login.tsx',
        importedSymbols: [],
        proximity: 1,
        relevanceScore: 1.0,
        importChain: ['changed.ts', 'src/pages/Login.tsx'],
      },
      {
        file: 'src/utils/helper.ts',
        importedSymbols: [],
        proximity: 2,
        relevanceScore: 0.7,
        importChain: ['changed.ts', 'src/utils/core.ts', 'src/utils/helper.ts'],
      }
    ];

    const mockMappings = [
      {
        component: 'changed.ts',
        pages: ['src/pages/Login.tsx'],
        routes: [],
      }
    ];

    vi.mocked(graphModule.buildDependencyGraph).mockResolvedValue(mockGraph);
    vi.mocked(graphModule.traceImpact).mockReturnValue(mockImpacted);
    vi.mocked(mapperModule.mapToPages).mockReturnValue(mockMappings);

    const startTime = Date.now();
    const result = await analyzeImpact(
      ['changed.ts'], 
      ['changed.ts', 'src/pages/Login.tsx', 'src/utils/core.ts', 'src/utils/helper.ts'], 
      '/repo', 
      { enabled: true, depthThreshold: 10 }
    );
    const duration = Date.now() - startTime;

    // Verify calls
    expect(graphModule.buildDependencyGraph).toHaveBeenCalled();
    expect(graphModule.traceImpact).toHaveBeenCalledWith(['changed.ts'], mockGraph, 10);
    expect(mapperModule.mapToPages).toHaveBeenCalledWith(mockImpacted, '/repo');

    // Verify result aggregation
    expect(result.changedFiles).toEqual(['changed.ts']);
    expect(result.impactedFiles).toHaveLength(2);
    expect(result.affectedPages).toContain('src/pages/Login.tsx');
    expect(result.affectedComponents).toContain('changed.ts');
    
    // Verify summary statistics
    expect(result.summary.totalImpacted).toBe(2);
    expect(result.summary.directDependents).toBe(1);
    expect(result.summary.transitiveDependents).toBe(1);
    expect(result.summary.affectedPageCount).toBe(1);

    // Performance target proxy check (mocked should be < 30s easily)
    expect(duration).toBeLessThan(30000);
  });
});
