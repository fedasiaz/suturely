import prompts from 'prompts';
import { loadConfig, saveConfig } from './config.js';

export type InteractiveArgs = {
  source: string;
  filterPackage?: string;
  pushPr: boolean;
  skipLint: boolean;
};

export async function runInteractive(): Promise<InteractiveArgs> {
  const config = await loadConfig();

  const response = await prompts([
    {
      type: 'text',
      name: 'source',
      message: 'GitHub repo URL or local path:',
      initial: config.lastRepo || 'https://github.com/user/repo',
      validate: (value: string) => (value.length > 0 ? true : 'Repository path cannot be empty'),
    },
    {
      type: 'text',
      name: 'apiKey',
      message: 'LLM API Key (leave empty to use .env):',
      initial: config.apiKey || '',
    },
    {
      type: 'text',
      name: 'model',
      message: 'LLM Model:',
      initial: config.model || 'gemini-2.5-flash-lite',
    },
    {
      type: 'text',
      name: 'filterPackage',
      message: 'Upgrade specific package (leave empty for all):',
      initial: '',
    },
    {
      type: 'confirm',
      name: 'pushPr',
      message: 'Push branch and open PR on GitHub?',
      initial: false,
    },
    {
      type: 'confirm',
      name: 'skipLint',
      message: 'Skip linters during tests?',
      initial: true,
    },
  ]);

  // Handle Ctrl+C cancellation
  if (!response.source) {
    console.log('\nCancelled by user.');
    process.exit(0);
  }

  // Save settings for next time
  await saveConfig({
    lastRepo: response.source,
    apiKey: response.apiKey || undefined,
    model: response.model || undefined,
  });

  // If the user provided an API key in the prompt, override the env var for this run
  if (response.apiKey) {
    process.env.LLM_API_KEY = response.apiKey;
  }

  return {
    source: response.source,
    filterPackage: response.filterPackage || undefined,
    pushPr: response.pushPr,
    skipLint: response.skipLint,
  };
}