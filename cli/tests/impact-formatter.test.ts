import { describe, it, expect } from 'vitest';
import { formatImpactTree } from '../src/impact-formatter.js';
import type { ImpactResult, ImpactNode } from '@openreview/core';

describe('formatImpactTree', () => {
  it('should format an empty impact result', () => {
    const emptyResult: ImpactResult = {
      changedFiles: [],
      impactedFiles: [],
      affectedPages: [],
      affectedComponents: [],
      summary: { totalImpacted: 0, directDependents: 0, transitiveDependents: 0, affectedPageCount: 0 }
    };
    
    const output = formatImpactTree(emptyResult);
    expect(output).toBe('No impact analysis data available or no files impacted.');
  });

  it('should format grouped proximity sections and import chains', () => {
    const impactedFiles: ImpactNode[] = [
      {
        file: 'src/components/Header.tsx',
        proximity: 1,
        relevanceScore: 1.0,
        importedSymbols: ['Button'],
        importChain: ['src/components/Button.tsx', 'src/components/Header.tsx']
      },
      {
        file: 'src/components/Footer.tsx',
        proximity: 1,
        relevanceScore: 1.0,
        importedSymbols: ['Button'],
        importChain: ['src/components/Button.tsx', 'src/components/Footer.tsx']
      },
      {
        file: 'src/pages/Home.tsx',
        proximity: 2,
        relevanceScore: 0.7,
        importedSymbols: ['Header'],
        importChain: ['src/components/Button.tsx', 'src/components/Header.tsx', 'src/pages/Home.tsx']
      },
      {
        file: 'src/app/DeepRoute.tsx',
        proximity: 4,
        relevanceScore: 0.35,
        importedSymbols: [],
        importChain: ['src/components/Button.tsx', 'src/components/Header.tsx', 'src/pages/Home.tsx', 'src/app/DeepRoute.tsx']
      }
    ];

    const result: ImpactResult = {
      changedFiles: ['src/components/Button.tsx'],
      impactedFiles,
      affectedPages: ['src/pages/Home.tsx', 'src/app/DeepRoute.tsx'],
      affectedComponents: ['src/components/Button.tsx'],
      summary: { totalImpacted: 4, directDependents: 2, transitiveDependents: 2, affectedPageCount: 2 }
    };

    const output = formatImpactTree(result);
    
    // Check main sections
    expect(output).toContain('🌳 IMPACT ANALYSIS TREE');
    expect(output).toContain('## Direct Dependents (Proximity 1)');
    expect(output).toContain('## 2nd Degree Dependents (Proximity 2)');
    expect(output).toContain('## Deeper Dependents (Proximity 4)');
    
    // Check file and score formatting
    expect(output).toContain('- 📄 src/components/Header.tsx (Score: 100)');
    expect(output).toContain('- 📄 src/pages/Home.tsx (Score: 70)');
    expect(output).toContain('- 📄 src/app/DeepRoute.tsx (Score: 35)');
    
    // Check chains
    expect(output).toContain('Chain: src/components/Button.tsx ➔ src/components/Header.tsx');
    expect(output).toContain('Chain: src/components/Button.tsx ➔ src/components/Header.tsx ➔ src/pages/Home.tsx');
    
    // Check pages mapping
    expect(output).toContain('🎯 AFFECTED UI PAGES & ROUTES');
    expect(output).toContain('  - 🌐 src/pages/Home.tsx');
    expect(output).toContain('  - 🧩 src/components/Button.tsx');
  });
});
