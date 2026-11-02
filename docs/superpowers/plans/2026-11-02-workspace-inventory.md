# Bounded Git/workspace inventory implementation plan

> **For agentic workers:** Use superpowers:executing-plans task by task.

**Goal:** A default-off, host-only read-only inventory collector for the existing node-recovery evidence contract.

**Architecture:** Canonical allowlisted normal Git checkout, isolated read-only Git commands, two matching observations and descriptor-checked bounded file hashes. Return only branch/HEAD/dirty-or-untracked relative paths/hashes/timestamps, no source bytes. Recovery inspector composes it with separate host-supplied measured stop/readiness facts; inventory alone grants no execution authority. Preserve old manifest entries; add explicit deletion entries.

**Tech Stack:** Node>=22, ESM, node:test, installed Git and existing Zod; no new package.

**Spec:** Original design§7/10/12, docs/NODE-RECOVERY.md; parent-authorized inventory then separate default-off offline review-surface work.

## Global constraints

Test temporary repositories only; no user/private repository scan, remote Git, credential/global config, source export, real executor, deployment, main merge or sandbox change. One queue/store/fence. Default closed. File paths/hashes stay local operational state, not telemetry. Never infer stopped/idle/persistent from inventory or missing heartbeat.

## Review focus

- Canonical roots/.git metadata/relative paths/symlinks/hardlinks cannot reach outside scope.
- Dirty/untracked/deletion and HEAD/branch/index changes never yield a partial successful manifest.
- Git cannot invoke fsmonitor/filter hooks, remote helpers or uncontrolled config includes.
- File/Git/output/metadata/count/time limits fail closed without content/error reflection.
- Recovery schema remains legacy-compatible; missing measured host facts rejects instead of inventing stop proof.

## Tasks

- [x] Write failing temporary-repo tests: clean/dirty/untracked/staged/deletion, scope/path/link/config traps, changing files/HEAD, limits and no writes. Implement minimal collector with canonical/metadata validation, bounded commands and double matching measurements; run GREEN, commit.
- [x] Write failing inspector/schema tests: actual coordinator accepts measured facts and identical inventory, old hashes remain valid, deleted entries explicit; no facts/dirty mismatch rejects, no executor starts from capture. Implement host-only composition; run GREEN, commit.
- [x] Document limits/trust boundary/rollback and next review UI stage. Independent review, Important fixes RED→GREEN, full verify, push independent draft based on PR34 and exact-head CI. Then continue separately scoped approval UI/host increment on this chain.
