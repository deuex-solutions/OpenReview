import path from 'path';
import { ImpactNode } from './types.js';

export interface PageMapping {
  component: string;
  pages: string[];
  routes: string[];
}

const PAGE_DIR_PATTERNS = [
  '/pages/',
  '/views/',
  '/screens/',
  '/routes/',
  '/app/', // Next.js app router
];

const PAGE_FILE_PATTERNS = [
  'page.tsx',
  'page.js',
  'page.jsx',
  'route.ts',
  'route.js',
  '+page.svelte',
  '+page.ts',
  '+page.js',
  '+server.ts',
];

/**
 * Detects if a file path represents a UI page or route definition.
 */
export function isPageOrRoute(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const paddedPath = '/' + normalizedPath;
  const basename = path.basename(normalizedPath).toLowerCase();

  // Check file name conventions
  if (PAGE_FILE_PATTERNS.includes(basename)) {
    return true;
  }

  // Check directory conventions
  if (PAGE_DIR_PATTERNS.some(dir => paddedPath.includes(dir))) {
    // If it's in a pages/ or views/ dir, and it's a component file
    if (/\.(tsx|jsx|vue|svelte)$/i.test(basename)) {
      return true;
    }
    // Also include Next.js/Remix typical route handlers if in these dirs
    if (/\.(ts|js)$/i.test(basename) && (paddedPath.includes('/api/') || paddedPath.includes('/routes/'))) {
      return true;
    }
  }

  return false;
}

/**
 * Maps impacted files back to the original changed components and identifies affected pages/routes.
 */
export function mapToPages(impactedFiles: ImpactNode[], repoPath: string): PageMapping[] {
  const mappingMap = new Map<string, { pages: Set<string>; routes: Set<string> }>();

  for (const node of impactedFiles) {
    if (!node.importChain || node.importChain.length === 0) continue;

    const changedFile = node.importChain[0];
    if (!mappingMap.has(changedFile)) {
      mappingMap.set(changedFile, { pages: new Set(), routes: new Set() });
    }

    if (isPageOrRoute(node.file)) {
      const isApiRoute = node.file.includes('/api/') || node.file.includes('route.ts') || node.file.includes('route.js') || node.file.includes('+server.ts');
      
      if (isApiRoute) {
        mappingMap.get(changedFile)!.routes.add(node.file);
      } else {
        mappingMap.get(changedFile)!.pages.add(node.file);
      }
    }
  }

  const results: PageMapping[] = [];
  for (const [component, data] of mappingMap.entries()) {
    if (data.pages.size > 0 || data.routes.size > 0) {
      results.push({
        component,
        pages: Array.from(data.pages),
        routes: Array.from(data.routes),
      });
    }
  }

  return results;
}
