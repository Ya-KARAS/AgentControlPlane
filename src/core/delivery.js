import { createHash } from "node:crypto";
import { ControlPlaneError } from './errors.js';

const invalid = () => new ControlPlaneError('invalid_delivery', 'Invalid bounded delivery metadata');
const states = ['not_requested', 'draft_pr', 'pending_review', 'changes_requested', 'closed'];
const checks = ['unknown', 'pending', 'passed', 'failed'];
const fields = new Set(['repository', 'base_branch', 'branch', 'pull_request_number', 'head_sha', 'checks', 'review_state', 'observed_at', 'reported_checks', 'reported_review_state', 'source', 'verification', 'approval_supported']);
function ref(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 &&
    !/[\x00-\x20\x7f~^:?*\[\\]/.test(value) && !value.includes('..') && !value.includes('@{') &&
    value !== '@' && !value.startsWith('-') && !value.endsWith('.') &&
    value.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.lock'));
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw invalid();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== (value.includes('.') ? value : value.replace('Z', '.000Z'))) throw invalid();
  return ms;
}
export function normalizeDelivery(input, { nowMs = Date.now() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.has(key)) || !Number.isSafeInteger(nowMs)) throw invalid();
  if (['approved', 'merged'].includes(input.review_state) || ['approved', 'merged'].includes(input.reported_review_state)) {
    throw new ControlPlaneError('human_approval_unavailable', 'No authenticated human approval or verified merge channel is configured');
  }
  const repository = input.repository;
  if (typeof repository !== 'string' || repository.length > 201 || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repository) || repository.endsWith('.git')) throw invalid();
  if (!ref(input.branch) || (input.base_branch != null && !ref(input.base_branch))) throw invalid();
  const pr = input.pull_request_number ?? null, sha = input.head_sha ?? null;
  if (pr !== null && (!Number.isSafeInteger(pr) || pr < 1)) throw invalid();
  if (sha !== null && (typeof sha !== 'string' || !/^[a-fA-F0-9]{40}$/.test(sha))) throw invalid();
  const observed = timestamp(input.observed_at);
  if (observed > nowMs || (input.source !== undefined && input.source !== 'manual') ||
      (input.verification !== undefined && input.verification !== 'unverified') ||
      (input.approval_supported !== undefined && input.approval_supported !== false)) throw invalid();
  const reportedChecks = input.reported_checks ?? input.checks ?? 'unknown';
  const reportedReview = input.reported_review_state ?? (input.review_state === 'unknown' ? 'not_requested' : input.review_state) ?? 'not_requested';
  if (!checks.includes(reportedChecks) || !states.includes(reportedReview) ||
      (input.checks !== undefined && !checks.includes(input.checks)) ||
      (input.review_state !== undefined && ![...states, 'unknown'].includes(input.review_state))) throw invalid();
  return { repository, base_branch: input.base_branch ?? null, branch: input.branch,
    pull_request_number: pr, head_sha: sha?.toLowerCase() ?? null,
    checks: 'unknown', review_state: 'unknown', reported_checks: reportedChecks, reported_review_state: reportedReview,
    observed_at: new Date(observed).toISOString(), source: 'manual', verification: 'unverified', approval_supported: false };
}
// Persisted replay evidence is private bookkeeping, never caller authority.
const observationHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function persistedDelivery(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const { _observation_hash, ...metadata } = input;
  const normalized = normalizeDelivery(metadata, options);
  if (_observation_hash !== undefined) {
    if (typeof _observation_hash !== 'string' || !/^[a-f0-9]{64}$/.test(_observation_hash)) throw invalid();
    normalized._observation_hash = _observation_hash;
  }
  return normalized;
}
export function safeDelivery(input) {
  try {
    const { _observation_hash, ...metadata } = persistedDelivery(input);
    return metadata;
  } catch { return null; }
}
export function transitionDelivery(current, input, options = {}) {
  const next = normalizeDelivery(input, options);
  const incomingHash = observationHash(next);
  if (!current) return { ...next, _observation_hash: incomingHash };
  const previous = persistedDelivery(current, options);
  if (previous.repository.toLowerCase() !== next.repository.toLowerCase() ||
      (previous.pull_request_number !== null && previous.pull_request_number !== next.pull_request_number)) {
    throw new ControlPlaneError('delivery_identity_conflict', 'Delivery repository or attached PR cannot silently change');
  }
  const time = Date.parse(next.observed_at) - Date.parse(previous.observed_at);
  if (time < 0) throw new ControlPlaneError('stale_delivery', 'An older delivery observation cannot replace the current one');
  if (time === 0) {
    const { _observation_hash, ...previousMetadata } = previous;
    if ((_observation_hash ?? observationHash(previousMetadata)) === incomingHash) return previous;
    throw new ControlPlaneError('delivery_conflict', 'Conflicting delivery observations have the same time');
  }
  if (previous.head_sha !== next.head_sha || previous.branch !== next.branch || previous.base_branch !== next.base_branch) {
    next.reported_checks = 'unknown';
    if (!['not_requested', 'draft_pr', 'closed'].includes(next.reported_review_state)) next.reported_review_state = 'pending_review';
  }
  return { ...next, _observation_hash: incomingHash };
}
