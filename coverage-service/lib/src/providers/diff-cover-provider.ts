import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { isAbsolute, join } from 'path';
import { promisify } from 'util';

import {
  parseCoberturaXml,
  parseDiffCoverFileCoverage,
  pathsMatch,
} from '../coverage/cobertura-parser';
import type { DiffCoverageReport, FileCoverage, UncoveredLine } from '../types';

import type { CoverageProvider } from './coverage-provider';

const execFileAsync = promisify(execFile);

interface DiffCoverInvocation {
  executable: string;
  prefixArgs: string[];
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function resolveDiffCoverInvocation(): DiffCoverInvocation {
  const configured = process.env.DIFF_COVER_BIN?.trim();
  if (configured) {
    const executable = isAbsolute(configured)
      ? configured
      : join(process.cwd(), configured);
    return { executable, prefixArgs: [] };
  }

  const localVenvBin = join(process.cwd(), '.venv-tools', 'bin', 'diff-cover');
  if (existsSync(localVenvBin)) {
    return { executable: localVenvBin, prefixArgs: [] };
  }

  return { executable: 'diff-cover', prefixArgs: [] };
}

function pythonModuleInvocation(): DiffCoverInvocation {
  const python = process.env.PYTHON_BIN?.trim() || 'python3';
  return {
    executable: python,
    prefixArgs: ['-m', 'diff_cover.diff_cover_tool'],
  };
}

export class DiffCoverProvider implements CoverageProvider {
  readonly name = 'diff-cover';

  async runDiffCoverage(
    coverageXmlPath: string,
    compareBranch: string,
    cwd: string,
  ): Promise<DiffCoverageReport> {
    const output = await this.runDiffCoverCli(
      coverageXmlPath,
      compareBranch,
      cwd,
      resolveDiffCoverInvocation(),
    );
    const diffCoveragePercent = this.parsePercent(
      output,
      /Coverage:\s*([\d.]+)%/i,
    );
    const totalCoveragePercent = this.parsePercent(
      output,
      /Total coverage:\s*([\d.]+)%/i,
    );
    const uncoveredLines = this.parseUncoveredLines(output);
    const filesWithPoorCoverage = this.parsePoorCoverageFiles(output);
    const cobertura = await parseCoberturaXml(coverageXmlPath);
    const fileDiffCoverage = parseDiffCoverFileCoverage(output);
    const fileCoverage = this.mergeFileCoverage(cobertura.files, fileDiffCoverage);

    return {
      diffCoveragePercent,
      totalCoveragePercent: cobertura.totalCoveragePercent || totalCoveragePercent,
      uncoveredLines,
      filesWithPoorCoverage,
      fileCoverage,
      rawOutput: output,
    };
  }

  private async runDiffCoverCli(
    coverageXmlPath: string,
    compareBranch: string,
    cwd: string,
    invocation: DiffCoverInvocation,
  ): Promise<string> {
    const args = [
      ...invocation.prefixArgs,
      coverageXmlPath,
      `--compare-branch=${compareBranch}`,
    ];

    try {
      const { stdout, stderr } = await execFileAsync(
        invocation.executable,
        args,
        { cwd, maxBuffer: 10 * 1024 * 1024 },
      );
      return stdout + stderr;
    } catch (err) {
      if (!isEnoent(err) || invocation.prefixArgs.length > 0) {
        throw this.wrapDiffCoverError(err);
      }

      try {
        return await this.runDiffCoverCli(
          coverageXmlPath,
          compareBranch,
          cwd,
          pythonModuleInvocation(),
        );
      } catch (fallbackErr) {
        throw this.wrapDiffCoverError(fallbackErr);
      }
    }
  }

  private wrapDiffCoverError(err: unknown): Error {
    const detail = err instanceof Error ? err.message : String(err);

    if (isEnoent(err)) {
      return new Error(
        'diff-cover is not installed. Run `npm run setup:worker-deps` from the repo root, ' +
          'or `pip install diff-cover` and ensure it is on PATH.\n' +
          detail,
      );
    }

    if (detail.includes('no merge base')) {
      return new Error(
        'diff-cover failed: git could not find a merge base for the compare branch. ' +
          'The cloned repository may be missing shared history with the base branch.\n' +
          detail,
      );
    }

    return new Error(`diff-cover failed:\n${detail}`);
  }

  private parsePercent(output: string, pattern: RegExp): number {
    const match = output.match(pattern);
    return match ? parseFloat(match[1]) : 0;
  }

  private parseUncoveredLines(output: string): UncoveredLine[] {
    const lines: UncoveredLine[] = [];
    const linePattern = /^(.+?):(\d+)(?::|$)/gm;
    let match: RegExpExecArray | null;
    while ((match = linePattern.exec(output)) !== null) {
      lines.push({ file: match[1].trim(), line: parseInt(match[2], 10) });
    }
    return lines;
  }

  private parsePoorCoverageFiles(output: string): string[] {
    const files: string[] = [];
    const filePattern = /Missing lines in (.+?):/g;
    let match: RegExpExecArray | null;
    while ((match = filePattern.exec(output)) !== null) {
      files.push(match[1].trim());
    }
    return [...new Set(files)];
  }

  private mergeFileCoverage(
    coberturaFiles: { file: string; lineCoveragePercent: number; uncoveredLines: number[] }[],
    diffByFile: Map<string, { diffCoveragePercent: number; uncoveredLines: number[] }>,
  ): FileCoverage[] {
    const allPaths = new Set<string>([
      ...coberturaFiles.map((f) => f.file),
      ...diffByFile.keys(),
    ]);

    return [...allPaths].map((file) => {
      const cob = coberturaFiles.find((f) => pathsMatch(f.file, file));
      const diffEntry = [...diffByFile.entries()].find(([k]) =>
        pathsMatch(k, file),
      );

      return {
        file,
        lineCoveragePercent: cob?.lineCoveragePercent ?? 0,
        diffCoveragePercent: diffEntry?.[1].diffCoveragePercent ?? null,
        // When diff-cover reports a file, use its diff-missing lines only — even when
        // that list is empty at 100%. Do not fall back to Cobertura uncovered lines.
        uncoveredLines:
          diffEntry !== undefined
            ? diffEntry[1].uncoveredLines
            : (cob?.uncoveredLines ?? []),
        allUncoveredLines: cob?.uncoveredLines ?? [],
      };
    });
  }
}
