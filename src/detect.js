import { existsSync } from 'node:fs';
import { join } from 'node:path';
export async function detectPM(dir) {
    if (existsSync(join(dir, 'pnpm-lock.yaml')))
        return 'pnpm';
    if (existsSync(join(dir, 'yarn.lock')))
        return 'yarn';
    return 'npm';
}
