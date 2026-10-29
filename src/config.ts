import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_PATH = join(homedir(), '.suturely.json');

export type SuturelyConfig = {
  lastRepo?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export async function loadConfig(): Promise<SuturelyConfig> {
  try {
    const data = await readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return {}; // Return empty if config doesn't exist
  }
}

export async function saveConfig(config: SuturelyConfig): Promise<void> {
  try {
    const current = await loadConfig();
    const updated = { ...current, ...config };
    await writeFile(CONFIG_PATH, JSON.stringify(updated, null, 2), 'utf8');
  } catch {
    // Ignore errors silently (e.g., permission issues)
  }
}