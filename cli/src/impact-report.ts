import fs from 'node:fs/promises';
import path from 'node:path';
import type { ImpactResult } from '@openreview/core';

/**
 * Writes the full ImpactResult to a JSON file.
 * 
 * @param result The impact analysis result.
 * @param outputPath The directory or specific file path to write to. If it's a directory, writes to `impact-report.json`.
 */
export async function writeImpactReport(result: ImpactResult, outputPath: string): Promise<void> {
  let targetPath = outputPath;

  try {
    const stats = await fs.stat(outputPath);
    if (stats.isDirectory()) {
      targetPath = path.join(outputPath, 'impact-report.json');
    }
  } catch (error: any) {
    // If the path doesn't exist, we check if it looks like a file extension
    if (error.code === 'ENOENT') {
      if (!path.extname(outputPath)) {
        // Assume it's a directory that needs to be created
        await fs.mkdir(outputPath, { recursive: true });
        targetPath = path.join(outputPath, 'impact-report.json');
      } else {
        // Ensure parent directory exists
        const parentDir = path.dirname(outputPath);
        await fs.mkdir(parentDir, { recursive: true });
      }
    } else {
      throw error;
    }
  }

  const outputData = JSON.stringify(result, null, 2);
  await fs.writeFile(targetPath, outputData, 'utf-8');
}
