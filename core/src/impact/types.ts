/**
 * Represents a single file impacted by a change.
 */
export interface ImpactNode {
  /** Relative file path */
  file: string;
  /** Symbols imported from the changed file that are used here */
  importedSymbols: string[];
  /** Proximity distance (1 = direct dependent, 2 = 2nd degree, etc.) */
  proximity: number;
  /** Calculated relevance score based on proximity (1.0 = direct) */
  relevanceScore: number;
  /** Full import chain from changed file to this node */
  importChain: string[];
}

/**
 * Result of an impact analysis session.
 */
export interface ImpactResult {
  /** The files that were changed (inputs) */
  changedFiles: string[];
  /** List of all files impacted, ordered by relevance */
  impactedFiles: ImpactNode[];
  /** UI pages or routes affected by these changes */
  affectedPages: string[];
  /** Specific UI components affected */
  affectedComponents: string[];
  /** Summary statistics of the impact */
  summary: {
    totalImpacted: number;
    directDependents: number;
    transitiveDependents: number;
    affectedPageCount: number;
  };
}

/**
 * Internal representation of the dependency graph.
 */
export interface ImpactGraph {
  /** Map of file path to its dependents (files that import it) */
  dependents: Map<string, Set<string>>;
  /** Map of file path to the symbols it exports */
  exports: Map<string, Set<string>>;
  /** Map of file path to the symbols it imports from other files */
  imports: Map<string, Map<string, Set<string>>>;
}

/**
 * Scoring constants for impact proximity.
 */
export const IMPACT_SCORES = {
  DIRECT: 1.0,
  SECOND_DEGREE: 0.7,
  THIRD_DEGREE: 0.5,
  DIMINISHING_FACTOR: 0.8, // multiply score by this for each additional level
} as const;

/**
 * Configuration options for impact analysis.
 */
export interface ImpactConfig {
  enabled: boolean;
  depthThreshold: number;
}

