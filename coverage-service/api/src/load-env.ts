import { existsSync } from 'fs';
import { resolve } from 'path';

import { config } from 'dotenv';

const envPaths = [
  // Prefer coverage-service/.env (README setup) over monorepo root .env
  resolve(__dirname, '../../.env'),
  resolve(__dirname, '../../../.env'),
  resolve(process.cwd(), '../.env'),
  resolve(process.cwd(), '.env'),
];

for (const path of envPaths) {
  if (existsSync(path)) {
    config({ path });
    break;
  }
}
