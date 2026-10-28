# AgentControlPlane release checklist

This checklist defines the repeatable release path for v0.9.3 and later.
Version 0.9.3 is a public test release, not a certified release.

## Current candidate acceptance boundary

Automatic reroute is excluded from this candidate's supported and validated
feature set. The classifier defect is fixed: nonempty `passed` or `not_run`
test evidence no longer masks an infrastructure failure. Only evidence proven
benign, an explicit `passed` result or an explicit `not_run` result whose detail
has no failure wording, leaves quota or rate-limit failures eligible to reroute.
The shipped configuration still defaults it off; existing opt-in configurations
are not changed. Keep the opt-in protocol instructions available for evaluation
without presenting the feature as supported.

Passing unit tests, static checks, or simulated upgrade checks does not establish
native Windows installation/upgrade, real browser dispatch, real-provider
execution, or complete runtime isolation. Record each required acceptance result
against the exact candidate artifact and runtime. Do not mark an unrun gate as
passed or treat this checklist as publication authorization. Linux Node.js 22/24
automated checks must be distinguished from the manual platform/browser/provider
checks still outstanding. See [v0.9.3 release notes](releases/v0.9.3.md).

## Clean release worktree

Create a dedicated worktree from the intended base branch. Keep machine
configuration, API keys, relay keys, demo workspaces, and scratch files outside
the release commit. Preserve the user's installed v0.9.0 directory and private
configuration/state/workspaces; the release worktree is not an in-place upgrade.

```powershell
git status --short
npm.cmd ci
npm.cmd run verify
```

`npm run verify` is the required code gate. User-facing release prose also runs
through `copy_lint.py` where that operator tool is available.

## Build release assets

Ensure the intended source files, including the new release notes and generated
userscript release, are tracked before packaging; the source packager uses
`git ls-files`. Do not add local configuration, state, credentials, or dependencies.

For v0.9.3 the ACP and browser companion versions are `0.9.3`, and the userscript
version is `0.9.6`. Promote the userscript through the supported command without
editing or replacing any historical release artifact:

```powershell
npm.cmd run userscript:release -- --version 0.9.6
npm.cmd run verify
npm.cmd run release:package
npm.cmd run release:sha256 -- `
  dist\agent-control-plane-v0.9.3-windows.zip `
  dist\agent-control-plane-browser-companion-v0.9.3.zip `
  --output dist\SHA256SUMS
```

Required assets:

- `agent-control-plane-v0.9.3-windows.zip`
- `agent-control-plane-browser-companion-v0.9.3.zip`
- `SHA256SUMS`

The source archive contains tracked repository files under one versioned root
directory. Its historical `-windows.zip` suffix is not a Windows validation
claim. The browser archive contains `manifest.json`, `src/`, and `popup/`.
ZIP entries use stable ordering and a fixed archive timestamp.

Optional standalone assets may be copied from `userscript/` into `dist/`:
`agent-control-plane-web-bridge.user.js`,
`agent-control-plane-web-bridge.meta.js`, and `release-manifest.json`.
If published, add those exact files to the `release:sha256` command before
uploading. Validate every referenced userscript manifest hash, including the
immutable `userscript/releases/0.9.6/agent-control-plane-web-bridge.user.js`.

There is no new v0.9.3 demo video requirement. Do not rename or reuse the v0.9.0
video as evidence for this release. Building these files does not update the
portal's stable auto-update endpoint; deployment requires the portal's existing
release process and separate public version/hash checks.

## Reproducibility checks

Run `npm run release:package` twice and compare SHA256 values. The two ZIP files
must keep identical hashes. Check the manifest from PowerShell:

```powershell
Get-Content dist\SHA256SUMS
Get-FileHash dist\*.zip -Algorithm SHA256
```

Extract the source archive into a temporary directory, then run:

```powershell
npm.cmd ci
npm.cmd run verify
npm.cmd run demo -- --help
npm.cmd run demo -- --check --executor <your-executor>
```

Use an isolated state directory outside all workspace roots for manual testing;
do not point parallel test instances at production state. Loading the browser
companion archive through Chrome's unpacked-extension flow and performing real
browser dispatch are separate manual checks. `npm run companion:check` validates
source consistency only. A live demo/provider test can use model quota and is
not part of the passive preflight or automatic release checks.

## GitHub publication

Only perform publication when authorized:

1. Merge the release pull request after CI succeeds.
2. Create a new immutable `v0.9.3` version tag pointing to the exact verified
   merge commit. A lightweight tag created by the normal GitHub Release flow
   is acceptable; do not move or replace any existing version tag.
3. Publish the GitHub Release using `docs/releases/v0.9.3.md`, clearly labeled as
   a public test release with the remaining manual verification boundary.
4. Upload the three required assets and any chosen optional userscript assets.
5. Download each uploaded asset and verify it against `SHA256SUMS`.
6. Open the release archive and run the documented demo help/preflight commands.
7. Do not claim portal auto-update deployment unless the public endpoint's
   versions and hashes have separately been verified.

## Historical v0.9.0 evidence

The v0.9.0 video presents the following historical OpenCode run. This is not
v0.9.3 acceptance evidence:

- task id: `c3aaa988-95a0-44ae-a646-090cd60ab105`
- executor: `opencode`
- model: `opencode/mimo-v2.5-free`
- terminal status: `completed`
- generated file: `.acp-demo\run-qLG0M9\hello.txt`
- verification: `true`
- reported usage: `10,148` tokens
