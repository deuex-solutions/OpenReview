import { execFile } from 'child_process';
import { promisify } from 'util';

import type { DiffCoverageReport, FileCoverage, UncoveredLine } from '../types';

import { parseCoberturaXml, pathsMatch } from './cobertura-parser';

const execFileAsync = promisify(execFile);

export function parseUnifiedDiffAddedLines(diff: string): number[] {
  const lines: number[] = [];
  let newLine = 0;

  for (const line of diff.split('\n')) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      newLine = parseInt(hunkMatch[3], 10);
      continue;
    }
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) {
      lines.push(newLine);
      newLine++;
    } else if (line.startsWith('-')) {
      // removed from old file; new-file line counter unchanged
    } else if (line.startsWith(' ') || line.startsWith('\\')) {
      newLine++;
    }
  }

  return lines;
}

export async function getDiffAddedLines(
  repoDir: string,
  compareRef: string,
  headBranch: string,
  filePath: string,
): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '-U0', `${compareRef}...${headBranch}`, '--', filePath],
      { cwd: repoDir },
    );
    return parseUnifiedDiffAddedLines(stdout);
  } catch {
    return [];
  }
}

export async function computeDiffCoverageFromGit(
  coverageXmlPath: string,
  repoDir: string,
  compareRef: string,
  headBranch: string,
  targetFiles: string[],
  thresholdPercent = 100,
): Promise<DiffCoverageReport> {
  const cobertura = coverageXmlPath
    ? await parseCoberturaXml(coverageXmlPath)
    : { totalCoveragePercent: 0, files: [] };
  const hasCoverageData = cobertura.files.length > 0;
  const fileCoverage: FileCoverage[] = [];
  const uncoveredLines: UncoveredLine[] = [];
  const filesWithPoorCoverage: string[] = [];
  let totalDiffLines = 0;
  let coveredDiffLines = 0;

  for (const filePath of targetFiles) {
    const diffLines = await getDiffAddedLines(
      repoDir,
      compareRef,
      headBranch,
      filePath,
    );
    if (diffLines.length === 0) continue;

    const cobFile = cobertura.files.find((f) => pathsMatch(f.file, filePath));
    const lineHits = cobFile?.lineHits ?? new Map<number, number>();

    let fileCovered = 0;
    const fileUncovered: number[] = [];

    for (const line of diffLines) {
      const hits = lineHits.get(line);
      if (hits === undefined) {
        if (!hasCoverageData) {
          totalDiffLines++;
          fileUncovered.push(line);
          uncoveredLines.push({ file: filePath, line });
        }
        continue;
      }

      totalDiffLines++;
      if (hits > 0) {
        coveredDiffLines++;
        fileCovered++;
      } else {
        fileUncovered.push(line);
        uncoveredLines.push({ file: filePath, line });
      }
    }

    const executableDiffLines = hasCoverageData
      ? diffLines.filter((l) => lineHits.has(l)).length
      : diffLines.length;
    const diffCoveragePercent =
      executableDiffLines > 0 ? (fileCovered / executableDiffLines) * 100 : 100;

    if (diffCoveragePercent < thresholdPercent && executableDiffLines > 0) {
      filesWithPoorCoverage.push(filePath);
    }

    fileCoverage.push({
      file: filePath,
      lineCoveragePercent: cobFile?.lineCoveragePercent ?? 0,
      diffCoveragePercent: executableDiffLines > 0 ? diffCoveragePercent : null,
      uncoveredLines: fileUncovered,
    });
  }

  const diffCoveragePercent =
    totalDiffLines > 0 ? (coveredDiffLines / totalDiffLines) * 100 : 100;

  const scopedFiles = cobertura.files.filter((f) =>
    targetFiles.some((t) => pathsMatch(t, f.file)),
  );
  const totalCoveragePercent =
    scopedFiles.length > 0
      ? scopedFiles.reduce((sum, f) => sum + f.lineCoveragePercent, 0) /
        scopedFiles.length
      : 0;

  return {
    diffCoveragePercent,
    totalCoveragePercent,
    uncoveredLines,
    filesWithPoorCoverage,
    fileCoverage,
    rawOutput: '',
  };
}
