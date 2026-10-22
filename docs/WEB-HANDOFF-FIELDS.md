# Web engineering handoff fields

The userscript candidate route preserves optional `context`,
`acceptance_criteria`, and `evidence_required` as separate string arrays through
local approval into the existing engineering brief. The web envelope may use a
single context string; the userscript normalizes that string to an array.
Legacy objective/constraints/execution/source candidates remain accepted.

Limits are not expanded: objective is at most 4,000 characters; context text
combined with newline separators is at most 1,000 characters; constraints,
context entries, acceptance entries and evidence entries together have at most
16 entries. Each acceptance entry is at most 980 characters; other entries at
most 1,000. Empty or non-string entries are rejected. Oversized fields are
rejected rather than silently truncated. Existing HTTP body limits still apply.
Execution choices retain their existing individual limits. Unknown nested
execution fields are rejected, not passed to executors.

Local review displays all sections, with HTML escaping. Replacing context,
constraints, acceptance criteria or evidence requirements triggers changed-field
confirmation in the userscript, as replacing the objective/route already does.
The sections are specification content, not permission to bypass approval,
workspace policy, provider authentication or executor controls.

The relay worker preserves these fields if its claim response supplies them.
This change does not modify or verify the external relay server contract. Do not
claim end-to-end remote support until that server preserves the fields too.
The separate browser-companion extension is unchanged by this patch.

The existing core brief, final result schema, usage accounting, shell capability
and executor authentication remain unchanged. Richer instructions can reduce
executor rediscovery, but no cost saving is established by this patch. Tests use
mock execution and do not consume provider quota.

Release gate: rebuild the current userscript using the repository build process,
verify source/bundle consistency, and run npm run verify in an authorized full
checkout. Do not modify historical releases manually. Source-only tests do not
establish that an installed browser userscript contains this change.
