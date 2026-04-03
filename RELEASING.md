# Releasing linkdqueue

This document describes how to create a new release of linkdqueue using the automated GitHub Actions release workflow.

## Overview

The release workflow (`.github/workflows/release.yml`) is triggered automatically whenever a Git tag matching the pattern `v*.*.*` is pushed to the repository. It builds the application for macOS, Linux, and Windows in parallel, then creates a GitHub Release with all three platform archives attached and auto-generated release notes.

## Prerequisites

- Write access to the `feoh/linkdqueue` repository
- [Git](https://git-scm.com/) installed locally
- The `main` (or release) branch in a clean, releasable state

## Steps to Create a Release

### 1. Update the Version Number

Edit `pubspec.yaml` and increment the `version` field. The format is `MAJOR.MINOR.PATCH+BUILD` (e.g. `1.2.0+2`).

```yaml
version: 1.2.0+2
```

Commit and push this change to the repository before tagging:

```bash
git add pubspec.yaml
git commit -m "Bump version to 1.2.0"
git push
```

### 2. Create and Push a Version Tag

Tags must follow the `v<MAJOR>.<MINOR>.<PATCH>` format (e.g. `v1.2.0`). This is what triggers the release workflow.

```bash
git tag v1.2.0
git push origin v1.2.0
```

> **Important:** The tag version should match the version you set in `pubspec.yaml`.

### 3. Monitor the Workflow

After pushing the tag:

1. Go to the repository on GitHub: <https://github.com/feoh/linkdqueue>
2. Click the **Actions** tab.
3. You will see a workflow run named **Release** triggered by the new tag.

The workflow runs four jobs:

| Job | Runner | Output |
|---|---|---|
| `build-macos` | `macos-latest` | `linkdqueue-macos.zip` |
| `build-linux` | `ubuntu-latest` | `linkdqueue-linux.tar.gz` |
| `build-windows` | `windows-latest` | `linkdqueue-windows.zip` |
| `release` | `ubuntu-latest` | GitHub Release with all three archives |

The three build jobs run in parallel. The `release` job waits for all of them to succeed before publishing.

### 4. Verify the Release

Once the workflow completes successfully:

1. Go to the **Releases** section of the repository.
2. Confirm the new release is listed with the correct tag name.
3. Verify that the following assets are attached:
   - `linkdqueue-macos.zip` — macOS `.app` bundle (universal)
   - `linkdqueue-linux.tar.gz` — Linux x64 bundle
   - `linkdqueue-windows.zip` — Windows x64 bundle
4. Review the auto-generated release notes and edit them on GitHub if needed.

## Troubleshooting

### Workflow did not start

- Confirm the tag matches the `v*.*.*` pattern exactly (e.g. `v1.2.0`, not `1.2.0` or `release-1.2.0`).
- Confirm the tag was pushed to the remote (`git push origin <tag>`).

### A build job failed

- Click the failed job in the Actions tab to see the full log.
- Common causes: a dependency version mismatch or a Flutter API change. Update `pubspec.yaml` or the Flutter version pin in the workflow file accordingly.
- After fixing the issue, delete the tag locally and remotely, then re-create it:

```bash
git tag -d v1.2.0
git push origin :refs/tags/v1.2.0
# fix the problem, commit, then re-tag
git tag v1.2.0
git push origin v1.2.0
```

### Release was not created

- Confirm the `release` job ran and check its logs.
- The workflow requires `contents: write` permission. If this was changed, restore it in `.github/workflows/release.yml`.
