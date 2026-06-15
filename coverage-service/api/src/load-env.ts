import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

const envPaths = [
  resolve(__dirname, '../../../.env'),
  resolve(__dirname, '../../.env'),
  resolve(process.cwd(), '../.env'),
  resolve(process.cwd(), '.env'),
];

for (const path of envPaths) {
  if (existsSync(path)) {
    config({ path });
    break;
  }
}
