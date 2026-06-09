import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { analyzeImpact } from '../../core/src/impact/analyzer.js';

test('E2E Eval: Impact Analysis Accuracy and Performance', async () => {
  // 1. Setup mock repository
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'impact-eval-'));
  
  try {
    // We will create a graph:
    // utils/math.ts -> components/Button.tsx -> components/Header.tsx -> pages/Home.tsx
    // pages/About.tsx -> components/Header.tsx
    
    await fs.mkdir(path.join(tmpDir, 'utils'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'components'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'pages'), { recursive: true });

    await fs.writeFile(path.join(tmpDir, 'utils/math.ts'), `
      export function add(a: number, b: number) { return a + b; }
    `);

    await fs.writeFile(path.join(tmpDir, 'components/Button.tsx'), `
      import { add } from '../utils/math';
      export const Button = () => <button>{add(1, 2)}</button>;
    `);

    await fs.writeFile(path.join(tmpDir, 'components/Header.tsx'), `
      import { Button } from './Button';
      export const Header = () => <header><Button /></header>;
    `);

    await fs.writeFile(path.join(tmpDir, 'pages/Home.tsx'), `
      import { Header } from '../components/Header';
      export const Home = () => <div><Header /></div>;
    `);

    await fs.writeFile(path.join(tmpDir, 'pages/About.tsx'), `
      import { Header } from '../components/Header';
      export const About = () => <div><Header /></div>;
    `);

    const changedFiles = ['utils/math.ts'];
    const allFiles = [
      'utils/math.ts',
      'components/Button.tsx',
      'components/Header.tsx',
      'pages/Home.tsx',
      'pages/About.tsx'
    ];

    // 2. Measure performance
    const start = performance.now();
    const result = await analyzeImpact(changedFiles, allFiles, tmpDir, { enabled: true, depthThreshold: 10 });
    const end = performance.now();
    const durationMs = end - start;

    // 3. Assert Accuracy
    // math.ts change should impact: Button (1), Header (2), Home (3), About (3)
    expect(result.summary.totalImpacted).toBe(4);
    expect(result.summary.directDependents).toBe(1); // Button
    expect(result.summary.transitiveDependents).toBe(3); // Header, Home, About
    
    // Check affected pages
    expect(result.affectedPages).toContain('pages/Home.tsx');
    expect(result.affectedPages).toContain('pages/About.tsx');
    expect(result.summary.affectedPageCount).toBe(2);

    // 4. Assert Performance
    // The requirement says < 30s for repos with <= 500 files.
    // For this 5-file repo, it should easily be < 50ms.
    console.log(`EVAL RESULT: Analyzed 5 files in ${durationMs.toFixed(2)}ms`);
    expect(durationMs).toBeLessThan(150); // Generous buffer for CI/eval environments

  } finally {
    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
