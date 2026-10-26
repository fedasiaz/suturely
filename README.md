# suturely

<img src="assets/icon-128.png" alt="suturely" width="96" height="96" align="right">

> Bot that upgrades npm dependencies and fixes what breaks.

![suturely demo](assets/demo.gif)

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

## GitHub Action Setup (Free & Autonomous)

You can run Suturely automatically on GitHub's servers for free. It will check for updates every Monday and open a PR if it finds something.

1. Copy the workflow file from `.github/workflows/suturely.yml` into your own repository.
2. Go to your repository **Settings → Secrets and variables → Actions**.
3. Add the following repository secrets based on your preferred LLM provider:

### Option A: Using Gemini (Recommended, higher limits)
- `LLM_API_KEY`: Your Google AI Studio key (starts with `AQ.` or `AIza`)
- `LLM_BASE_URL`: `https://generativelanguage.googleapis.com/v1beta/openai/`
- `LLM_MODEL`: `gemini-2.5-flash-lite`

### Option B: Using Groq (Faster, but lower token limits)
- `LLM_API_KEY`: Your Groq key (starts with `gsk_`)
- `LLM_BASE_URL`: `https://api.groq.com/openai/v1`
- `LLM_MODEL`: `openai/gpt-oss-120b`

4. Go to the **Actions** tab in your repository, select `suturely Auto-Upgrade`, and click **Run workflow**.

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