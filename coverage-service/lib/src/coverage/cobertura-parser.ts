import { readFile } from 'fs/promises';

export interface CoberturaFileCoverage {
  file: string;
  lineCoveragePercent: number;
  uncoveredLines: number[];
  /** Executable line number → hit count from Cobertura XML. */
  lineHits: Map<number, number>;
}

export interface CoberturaReport {
  totalCoveragePercent: number;
  files: CoberturaFileCoverage[];
}

function getXmlAttr(tag: string, attr: string): string | null {
  const match = tag.match(new RegExp(`${attr}="([^"]*)"`));
  return match ? match[1] : null;
}

function parseMissingLineRanges(spec: string): number[] {
  const lines: number[] = [];
  for (const part of spec.split(',')) {
    const trimmed = part.trim();
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = start; i <= end; i++) lines.push(i);
    } else if (/^\d+$/.test(trimmed)) {
      lines.push(parseInt(trimmed, 10));
    }
  }
  return lines;
}

export async function parseCoberturaXml(
  xmlPath: string,
): Promise<CoberturaReport> {
  const xml = await readFile(xmlPath, 'utf-8');

  const rootTag = xml.match(/<coverage[^>]*>/)?.[0] ?? '';
  const rootLineRate = getXmlAttr(rootTag, 'line-rate');
  const totalCoveragePercent = rootLineRate
    ? parseFloat(rootLineRate) * 100
    : 0;

  const files: CoberturaFileCoverage[] = [];
  const classPattern = /<class\b[^>]*>[\s\S]*?<\/class>/g;
  let classMatch: RegExpExecArray | null;

  while ((classMatch = classPattern.exec(xml)) !== null) {
    const classBlock = classMatch[0];
    const openTag = classBlock.match(/<class\b[^>]*>/)?.[0] ?? '';
    const file = getXmlAttr(openTag, 'filename');
    if (!file) continue;

    const lineRate = getXmlAttr(openTag, 'line-rate');
    const lineCoveragePercent = lineRate ? parseFloat(lineRate) * 100 : 0;

    const uncoveredLines: number[] = [];
    const lineHits = new Map<number, number>();
    const linePattern = /<line\b[^>]*>/g;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = linePattern.exec(classBlock)) !== null) {
      const lineTag = lineMatch[0];
      const hits = getXmlAttr(lineTag, 'hits');
      const number = getXmlAttr(lineTag, 'number');
      if (!number) continue;

      const lineNum = parseInt(number, 10);
      const hitCount = parseInt(hits ?? '0', 10);
      lineHits.set(lineNum, hitCount);
      if (hitCount === 0) {
        uncoveredLines.push(lineNum);
      }
    }

    files.push({ file, lineCoveragePercent, uncoveredLines, lineHits });
  }

  return { totalCoveragePercent, files };
}

export function parseDiffCoverFileCoverage(output: string): Map<
  string,
  { diffCoveragePercent: number; uncoveredLines: number[] }
> {
  const map = new Map<
    string,
    { diffCoveragePercent: number; uncoveredLines: number[] }
  >();

  const pattern = /^(.+?) \(([\d.]+)%\)(?:: Missing lines (.+))?$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(output)) !== null) {
    const file = match[1].trim();
    const diffCoveragePercent = parseFloat(match[2]);
    const uncoveredLines = match[3]
      ? parseMissingLineRanges(match[3])
      : [];
    map.set(file, { diffCoveragePercent, uncoveredLines });
  }

  return map;
}

/** Parse aggregate line counts from diff-cover CLI output. */
export function parseDiffCoverTotals(
  output: string,
): { total: number; missing: number } | null {
  const totalMatch = output.match(/Total:\s*(\d+)\s*lines/i);
  if (!totalMatch) return null;
  const missingMatch = output.match(/Missing:\s*(\d+)\s*lines/i);
  return {
    total: parseInt(totalMatch[1], 10),
    missing: missingMatch ? parseInt(missingMatch[1], 10) : 0,
  };
}

export function normalizeFilePath(path: string): string {
  return path.replace(/^\.\//, '').replace(/\\/g, '/');
}

export function pathsMatch(a: string, b: string): boolean {
  const na = normalizeFilePath(a);
  const nb = normalizeFilePath(b);
  return na === nb || na.endsWith(nb) || nb.endsWith(na);
}
