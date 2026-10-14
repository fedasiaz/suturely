# suturely

<img src="assets/icon-128.png" alt="suturely" width="96" height="96" align="right">

> Bot that upgrades npm dependencies and fixes what breaks.

`suturely` takes the pain out of dependency upgrades. It runs your tests before and after, and if something breaks — an LLM reads the error and patches the code. Only opens a PR when tests are green.

## Why

Dependabot opens PRs but leaves you to fix the fallout. About 11% of npm upgrades break tests — and most of those PRs sit red for weeks.

`suturely` does three things Dependabot doesn't:

1. Runs your tests **before** and **after** the upgrade.
2. If they break, asks an LLM to fix the code.
3. Only opens a PR when tests are green (or clearly marks RED).

## Install

```bash
git clone https://github.com/fedasiaz/suturely
cd suturely
npm install
cp .env.example .env   # then edit with your keys
npm run build
```

## Usage

```bash
# dry run on any public repo
node dist/index.js https://github.com/user/repo --package=lodash --dry-run

# real run: pushes branch and opens PR
node dist/index.js https://github.com/you/repo --package=lodash --push-pr
```

### Flags

| Flag | What it does |
|------|--------------|
| `--package=name` | Upgrade only this package |
| `--all-major` | Upgrade every package with a major bump |
| `--push-pr` | Push branch and open PR on GitHub |
| `--dry-run` | Do everything except commit/push |
| `--skip-baseline` | Skip the "tests before upgrade" check |
| `--skip-lint` | Drop linters from test commands |
| `--no-smoke` | Skip `npm start` smoke test |

## How it works

1. Clone repo to temp dir.
2. Run tests on **current** state → baseline.
3. Bump one dependency.
4. Run tests again.
5. If broken → LLM reads error, proposes fix, retries (up to 3 times).
6. Push branch, open PR.

## Requirements

- Node.js 20+
- LLM API key (Groq, OpenRouter, or any OpenAI-compatible endpoint)
- GitHub token with `repo` scope (only for `--push-pr`)

## License

MIT