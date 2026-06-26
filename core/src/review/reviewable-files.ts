const SKIP_PATTERNS: RegExp[] = [
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
  /^package-lock\.json$/,
  /\.lock$/,
  /\.min\.(js|css)$/,
  /\.map$/,
  /\.snap$/,
  /\.svg$/,
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.gif$/,
  /\.ico$/,
  /\.woff2?$/,
  /\.ttf$/,
  /\.eot$/,
  /\.pdf$/,
  /dist\//,
  /\.generated\./,
  /vendor\//,
];

export function isReviewableFile(filename: string): boolean {
  return !SKIP_PATTERNS.some((pattern) => pattern.test(filename));
}

export function filterReviewableFiles(files: string[]): string[] {
  return files.filter(isReviewableFile).sort();
}
