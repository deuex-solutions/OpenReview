import { execFile } from 'child_process';
import { promisify } from 'util';
import { CoverageProvider } from './coverage-provider';
import { DiffCoverageReport, FileCoverage } from '../types';
import { parseCoberturaXml } from '../coverage/cobertura-parser';

const execFileAsync = promisify(execFile);

export class CovPeekProvider implements CoverageProvider {
  readonly name = 'covpeek';

  async runDiffCoverage(
    coverageXmlPath: string,
    compareBranch: string,
    cwd: string,
  ): Promise<DiffCoverageReport> {
    try {
      const { stdout, stderr } = await execFileAsync(
        'covpeek',
        ['diff', coverageXmlPath, '--base', compareBranch],
        { cwd, maxBuffer: 10 * 1024 * 1024 },
      );
      const output = stdout + stderr;
      const diffMatch = output.match(/diff coverage:\s*([\d.]+)%/i);
      const totalMatch = output.match(/total coverage:\s*([\d.]+)%/i);
      const cobertura = await parseCoberturaXml(coverageXmlPath);
      const fileCoverage: FileCoverage[] = cobertura.files.map((f) => ({
        file: f.file,
        lineCoveragePercent: f.lineCoveragePercent,
        diffCoveragePercent: null,
        uncoveredLines: f.uncoveredLines,
      }));

      return {
        diffCoveragePercent: diffMatch ? parseFloat(diffMatch[1]) : 0,
        totalCoveragePercent:
          cobertura.totalCoveragePercent ||
          (totalMatch ? parseFloat(totalMatch[1]) : 0),
        uncoveredLines: [],
        filesWithPoorCoverage: [],
        fileCoverage,
        rawOutput: output,
      };
    } catch {
      throw new Error(
        'covpeek is not installed or failed. Install covpeek or use diff-cover provider.',
      );
    }
  }
}
