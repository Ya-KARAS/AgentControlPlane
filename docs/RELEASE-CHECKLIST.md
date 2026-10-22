# AgentControlPlane release checklist

This checklist defines the repeatable release path for v0.9.0 and later.

## Current candidate acceptance boundary

Automatic reroute is excluded from this candidate's supported and validated
feature set. Its error-classifier defect is not fixed: nonempty test evidence,
including `passed` or `not_run` entries, can mask infrastructure failures and
prevent rerouting. The shipped configuration defaults it off; existing opt-in
configurations are not changed. Keep the opt-in protocol instructions available
for evaluation without presenting the feature as supported.

Passing unit tests, static checks, or simulated upgrade checks does not establish
native Windows installation/upgrade, real browser dispatch, real-provider
execution, or complete runtime isolation. Record each required acceptance result
against the exact candidate artifact and runtime. Do not mark an unrun gate as
passed or treat this checklist as publication authorization.

## Clean release worktree

Create a dedicated worktree from the intended base branch. Keep machine
configuration, API keys, relay keys, demo workspaces, and scratch files outside
the release commit.

```powershell
git status --short
npm.cmd ci
npm.cmd run verify
```

`npm run verify` is the required code gate. User-facing release prose also runs
through `copy_lint.py`.

## Build release assets

```powershell
npm.cmd run release:package
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\create-demo-video.ps1
npm.cmd run release:sha256 -- `
  dist\agent-control-plane-v0.9.0-windows.zip `
  dist\agent-control-plane-browser-companion-v0.9.0.zip `
  dist\agent-control-plane-v0.9.0-demo.mp4 `
  --output dist\SHA256SUMS
```

Expected assets:

- `agent-control-plane-v0.9.0-windows.zip`
- `agent-control-plane-browser-companion-v0.9.0.zip`
- `agent-control-plane-v0.9.0-demo.mp4`
- `SHA256SUMS`

The Windows archive contains tracked repository files under one versioned root
directory. The browser archive contains `manifest.json`, `src/`, and `popup/`.
ZIP entries use stable ordering and a fixed archive timestamp.

## Reproducibility checks

Run `npm run release:package` twice and compare SHA256 values. The two ZIP files
must keep identical hashes. Check the manifest from PowerShell:

```powershell
Get-Content dist\SHA256SUMS
Get-FileHash dist\*.zip -Algorithm SHA256
```

Extract the Windows archive into a temporary directory, then run:

```powershell
npm.cmd ci
npm.cmd run verify
npm.cmd run demo -- --help
```

Load the browser companion archive through Chrome's unpacked-extension flow and
run `npm run companion:check` from the source tree.

## GitHub publication

1. Merge the release pull request after CI succeeds.
2. Create the signed or annotated `v0.9.0` tag from the merged commit.
3. Publish the GitHub Release using `docs/releases/v0.9.0.md`.
4. Upload the four expected assets.
5. Download each uploaded asset and verify it against `SHA256SUMS`.
6. Open the release archive and run the documented demo help command.

## Recorded evidence

The v0.9.0 video presents the verified OpenCode run:

- task id: `c3aaa988-95a0-44ae-a646-090cd60ab105`
- executor: `opencode`
- model: `opencode/mimo-v2.5-free`
- terminal status: `completed`
- generated file: `.acp-demo\run-qLG0M9\hello.txt`
- verification: `true`
- reported usage: `10,148` tokens
