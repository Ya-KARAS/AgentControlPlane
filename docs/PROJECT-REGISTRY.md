# Project registry

AgentControlPlane separates project discovery from execution authorization.
Natural-language project selection stays stable when a repository moves
between folders or drives. Execution access covers registered project paths;
parent discovery directories remain scan-only.

## Model

Each registered project has a persistent random project ID, a display name, a
logical category, a current local path, and a monotonically increasing path
revision. Web AI capability summaries receive only the stable ID, category,
name, status, and revision. Absolute local paths remain on the local machine.

`workspaceRoots` remains the backward-compatible list of explicit execution
workspaces. `projectDiscoveryRoots` is an optional list of parent directories
that ACP may scan for projects. A discovery root is never itself offered as an
execution workspace. Detected projects become individually registered
workspaces.

```json
{
  "workspaceRoots": [
    "C:\\Users\\YOUR_USER\\Documents\\Github\\AgentControlPlane"
  ],
  "projectDiscoveryRoots": [
    "C:\\Users\\YOUR_USER\\Documents\\Github",
    "D:\\Development"
  ]
}
```

Additional discovery roots can be added from the loopback-only local settings
page. The registry persists under the ACP state directory, outside every
workspace.

## Local project library

Open `http://127.0.0.1:4318/local-review/settings` and use the project library:

1. Paste the exact project folder path and select **添加项目**.
2. Select **设为默认** on the project used for the next web conversation.
3. Open **需要处理的项目** when ACP reports a moved or missing project.
4. Select **确认新位置** when ACP finds one matching location, or enter the
   project folder path under **填写新位置**.
5. Select **移除记录** to remove a stale registry entry. This action leaves the
   project files on disk.

The **高级设置** section contains discovery roots, manual rescanning,
categories, and path revisions. Adding a project enrolls its parent folder as
a discovery root so later scans can find the project after a folder or drive
move.

## Moving a project

When a registered path disappears, ACP marks the project `missing`. Scanning
trusted discovery roots may produce relocation candidates, but matching Git
metadata never authorizes an automatic relink because multiple clones and
worktrees can share the same remote.

The user confirms the new path on the local settings page. A unique scanned
candidate supports one-click confirmation. Relinking:

- preserves the stable project ID and category
- increments the path revision
- refuses paths outside trusted discovery roots
- refuses relinking while a task for the project is queued or running
- prevents reuse of an executor thread created for an older path revision
- lets a continuation preserve `logical_task_id` and `parentTaskId` while
  starting a fresh executor session in the new workspace

The browser conversation can therefore continue. Its natural-language context
does not depend on the physical drive letter, while ACP still performs a fresh
local path check before execution.

## Security invariants

- Filesystem volume roots cannot be discovery roots.
- ACP state cannot be inside a discovery root.
- Discovery roots are scan-only and are not dispatch choices.
- Symlink or junction escapes are not followed by discovery.
- Project paths are canonicalized before registration and execution.
- Missing projects never silently fall back to another workspace.
- Web capability summaries never include absolute local project paths.
