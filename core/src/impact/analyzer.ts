import { buildDependencyGraph, traceImpact } from './graph.js';
import { mapToPages } from './component-mapper.js';
import { ImpactConfig, ImpactResult } from './types.js';

/**
 * Main entry point for the impact analysis module.
 * Orchestrates the full pipeline: graph building -> traversal -> mapping -> formatting.
 * 
 * @param changedFiles The list of files that were modified.
 * @param allFiles List of all files in the repository to build the graph.
 * @param repoPath Absolute path to the repository root.
 * @param config Configuration options.
 */
export async function analyzeImpact(
  changedFiles: string[],
  allFiles: string[],
  repoPath: string,
  config: ImpactConfig
): Promise<ImpactResult> {
  // Respect enabled flag
  if (!config.enabled || changedFiles.length === 0) {
    return {
      changedFiles,
      impactedFiles: [],
      affectedPages: [],
      affectedComponents: [],
      summary: {
        totalImpacted: 0,
        directDependents: 0,
        transitiveDependents: 0,
        affectedPageCount: 0,
      },
    };
  }

  // 1. Build the dependency graph
  const graph = await buildDependencyGraph(allFiles, repoPath);

  // 2. Trace impact starting from changed files
  const impactedFiles = traceImpact(changedFiles, graph, config.depthThreshold);

  // 3. Map impacted files to UI pages and routes
  const pageMappings = mapToPages(impactedFiles, repoPath);

  // 4. Compile lists of affected pages and components
  const affectedPagesSet = new Set<string>();
  const affectedComponentsSet = new Set<string>();

  for (const mapping of pageMappings) {
    affectedComponentsSet.add(mapping.component);
    mapping.pages.forEach(p => affectedPagesSet.add(p));
    mapping.routes.forEach(r => affectedPagesSet.add(r));
  }

  const affectedPages = Array.from(affectedPagesSet);
  const affectedComponents = Array.from(affectedComponentsSet);

  // 5. Calculate summary statistics
  let directDependents = 0;
  let transitiveDependents = 0;

  for (const node of impactedFiles) {
    if (node.proximity === 1) {
      directDependents++;
    } else if (node.proximity > 1) {
      transitiveDependents++;
    }
  }

  return {
    changedFiles,
    impactedFiles,
    affectedPages,
    affectedComponents,
    summary: {
      totalImpacted: impactedFiles.length,
      directDependents,
      transitiveDependents,
      affectedPageCount: affectedPages.length,
    },
  };
}
