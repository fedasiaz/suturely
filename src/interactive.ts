import prompts from 'prompts';

export type InteractiveArgs = {
  source: string;
  filterPackage?: string;
  pushPr: boolean;
  skipLint: boolean;
};

export async function runInteractive(): Promise<InteractiveArgs> {
  const response = await prompts([
    {
      type: 'text',
      name: 'source',
      message: 'GitHub repo URL or local path:',
      initial: 'https://github.com/user/repo',
      validate: (value: string) => (value.length > 0 ? true : 'Repository path cannot be empty'),
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

  return {
    source: response.source,
    filterPackage: response.filterPackage || undefined,
    pushPr: response.pushPr,
    skipLint: response.skipLint,
  };
}