import fs from 'fs/promises';
import path from 'path';

import { ImpactGraph, ImpactNode, IMPACT_SCORES } from './types.js';
import { extractImports, extractExports } from './tree-sitter.js';

/**
 * Builds a dependency graph from a list of files using Tree-sitter.
 */
export async function buildDependencyGraph(files: string[], repoPath: string): Promise<ImpactGraph> {
  const graph: ImpactGraph = {
    dependents: new Map(),
    exports: new Map(),
    imports: new Map(),
  };

  // Build a lookup for quick resolution
  const fileLookup = new Map<string, string>();
  for (const file of files) {
    fileLookup.set(file, file);
    // Remove extension for lookup
    const parsed = path.parse(file);
    const withoutExt = path.join(parsed.dir, parsed.name);
    fileLookup.set(withoutExt, file);
    // For index files
    if (parsed.name === 'index') {
      fileLookup.set(parsed.dir, file);
    }
  }

  // Using a normal loop to ensure no excessive concurrent reads if files is large,
  // but Promise.all is faster. We'll stick to sequential for simplicity unless performance dictates.
  for (const file of files) {
    const fullPath = path.isAbsolute(file) ? file : path.join(repoPath, file);
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      
      const { symbols: exportedSymbols } = extractExports(fullPath, content);
      graph.exports.set(file, new Set(exportedSymbols));

      const imports = extractImports(fullPath, content);
      const fileImportMap = new Map<string, Set<string>>();
      
      for (const imp of imports) {
        let resolvedImportPath: string | undefined;
        
        // Ensure standard separators
        const normalizedSource = imp.source.replace(/\\/g, '/');

        if (normalizedSource.startsWith('.')) {
          const absoluteImportDir = path.dirname(file);
          const resolvedRel = path.join(absoluteImportDir, normalizedSource);
          resolvedImportPath = fileLookup.get(resolvedRel) || fileLookup.get(resolvedRel + '.ts') || fileLookup.get(resolvedRel + '.js');
        } else {
          resolvedImportPath = fileLookup.get(normalizedSource);
        }

        if (resolvedImportPath) {
          if (!fileImportMap.has(resolvedImportPath)) {
            fileImportMap.set(resolvedImportPath, new Set());
          }
          for (const sym of imp.symbols) {
            fileImportMap.get(resolvedImportPath)!.add(sym);
          }
          
          if (!graph.dependents.has(resolvedImportPath)) {
            graph.dependents.set(resolvedImportPath, new Set());
          }
          graph.dependents.get(resolvedImportPath)!.add(file);
        }
      }
      
      graph.imports.set(file, fileImportMap);
      
    } catch (err) {
      // Ignore files we can't read
    }
  }

  return graph;
}

/**
 * Traces the impact of changed files through the dependency graph.
 */
export function traceImpact(
  changedFiles: string[],
  graph: ImpactGraph,
  depthThreshold: number = 10
): ImpactNode[] {
  const impactMap = new Map<string, ImpactNode>();
  
  // Queue for BFS: [file, distance, importChain]
  const queue: Array<[string, number, string[]]> = [];
  
  for (const file of changedFiles) {
    queue.push([file, 0, [file]]);
  }
  
  const calculateScore = (distance: number): number => {
    if (distance === 1) return IMPACT_SCORES.DIRECT;
    if (distance === 2) return IMPACT_SCORES.SECOND_DEGREE;
    if (distance === 3) return IMPACT_SCORES.THIRD_DEGREE;
    
    let score = IMPACT_SCORES.THIRD_DEGREE;
    for (let i = 3; i < distance; i++) {
      score *= IMPACT_SCORES.DIMINISHING_FACTOR;
    }
    return score;
  };

  while (queue.length > 0) {
    const [currentFile, distance, chain] = queue.shift()!;
    
    if (distance > depthThreshold) continue;

    if (distance > 0) {
      const score = calculateScore(distance);
      const existing = impactMap.get(currentFile);
      
      if (!existing || existing.relevanceScore < score) {
        const prevFile = chain[chain.length - 2];
        let importedSymbols: string[] = [];
        if (prevFile && graph.imports.has(currentFile)) {
          const importsFromPrev = graph.imports.get(currentFile)!.get(prevFile);
          if (importsFromPrev) {
            importedSymbols = Array.from(importsFromPrev);
          }
        }

        impactMap.set(currentFile, {
          file: currentFile,
          importedSymbols,
          proximity: distance,
          relevanceScore: score,
          importChain: [...chain],
        });
      } else if (existing && existing.relevanceScore >= score) {
        continue;
      }
    }

    const dependents = graph.dependents.get(currentFile);
    if (dependents) {
      for (const dependent of dependents) {
        if (!chain.includes(dependent)) {
          queue.push([dependent, distance + 1, [...chain, dependent]]);
        }
      }
    }
  }

  const results = Array.from(impactMap.values());
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  
  return results;
}
