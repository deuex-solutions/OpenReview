import { DiffCoverageReport } from '../types';

export interface CoverageProvider {
  readonly name: string;
  runDiffCoverage(
    coverageXmlPath: string,
    compareBranch: string,
    cwd: string,
  ): Promise<DiffCoverageReport>;
}
