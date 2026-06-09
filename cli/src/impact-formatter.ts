import type { ImpactResult, ImpactNode } from '@openreview/core';

export function formatImpactTree(result: ImpactResult): string {
  if (!result || result.impactedFiles.length === 0) {
    return 'No impact analysis data available or no files impacted.';
  }

  const lines: string[] = [];
  lines.push('================================================================================');
  lines.push('🌳 IMPACT ANALYSIS TREE');
  lines.push('================================================================================');
  lines.push('');

  // Group by proximity
  const byProximity = new Map<number, ImpactNode[]>();
  for (const node of result.impactedFiles) {
    const group = byProximity.get(node.proximity) || [];
    group.push(node);
    byProximity.set(node.proximity, group);
  }

  const sortedProximities = Array.from(byProximity.keys()).sort((a, b) => a - b);

  for (const proximity of sortedProximities) {
    const nodes = byProximity.get(proximity) || [];
    
    // Determine section title
    let sectionTitle = '';
    if (proximity === 1) sectionTitle = 'Direct Dependents (Proximity 1)';
    else if (proximity === 2) sectionTitle = '2nd Degree Dependents (Proximity 2)';
    else if (proximity === 3) sectionTitle = '3rd Degree Dependents (Proximity 3)';
    else sectionTitle = `Deeper Dependents (Proximity ${proximity})`;

    lines.push(`## ${sectionTitle}`);
    
    for (const node of nodes) {
      // Score and File
      const scoreStr = (node.relevanceScore * 100).toFixed(0);
      lines.push(`- 📄 ${node.file} (Score: ${scoreStr})`);
      
      // Import Chain Path
      if (node.importChain && node.importChain.length > 1) {
        // Show path starting from the changed file
        const pathStr = node.importChain.join(' ➔ ');
        lines.push(`    Chain: ${pathStr}`);
      }
    }
    lines.push('');
  }

  // Component-to-Page Mapping Highlight
  if (result.affectedPages.length > 0 || result.affectedComponents.length > 0) {
    lines.push('--------------------------------------------------------------------------------');
    lines.push('🎯 AFFECTED UI PAGES & ROUTES');
    lines.push('--------------------------------------------------------------------------------');
    lines.push('');
    
    if (result.affectedPages.length > 0) {
      lines.push('Affected Pages/Routes:');
      for (const page of result.affectedPages) {
        lines.push(`  - 🌐 ${page}`);
      }
      lines.push('');
    }
    
    if (result.affectedComponents.length > 0) {
      lines.push('Modified Components triggering these updates:');
      for (const comp of result.affectedComponents) {
        lines.push(`  - 🧩 ${comp}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
