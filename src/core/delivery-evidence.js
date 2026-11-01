import { createHash } from 'node:crypto';

const fail = () => { throw new Error('Invalid delivery evidence'); };
const ownKeys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function time(value) {
  if (typeof value !== 'string') fail();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) fail();
  return ms;
}
function targetIdentity(value) {
  if (!ownKeys(value, ['repository', 'pull_request_number', 'head_sha']) ||
      typeof value.repository !== 'string' || value.repository.split('/').length !== 2 ||
      !value.repository.split('/').every(identifier) || !Number.isSafeInteger(value.pull_request_number) ||
      value.pull_request_number < 1 || !sha(value.head_sha)) fail();
  return { repository: value.repository, pull_request_number: value.pull_request_number, head_sha: value.head_sha };
}
const sameTarget = (a,b) => a.repository === b.repository && a.pull_request_number === b.pull_request_number && a.head_sha === b.head_sha;
const unknown = reason => ({ preview_only: true, approval_supported: false,
  effective: { checks: 'unknown', review_state: 'unknown' }, candidate: null, reason });

// Host-only dependency injection. This module does not authenticate transport
// JSON: a future adapter must first verify the source and complete pagination.
// It is deliberately not connected to store setters or HTTP/MCP/CLI paths.
export function createDeliveryEvidenceEvaluator({ adapter, authorizeUser, clock = Date.now } = {}) {
  const events = new Map();
  const observations = new Map();
  const latestDecisions = new Map();
  return Object.freeze({
    async evaluate(input) {
      if (!adapter || typeof adapter.readObservation !== 'function' || typeof adapter.readHead !== 'function') return unknown('adapter_unconfigured');
      try {
        const target = Object.freeze(targetIdentity(input));
        const evidence = await adapter.readObservation(target);
        const now = clock();
        if (!Number.isSafeInteger(now) || !ownKeys(evidence, ['repository','pull_request_number','head_sha','checks','complete','observed_at','valid_until','decisions']) ||
            !sameTarget(target, targetIdentity({ repository:evidence.repository, pull_request_number:evidence.pull_request_number, head_sha:evidence.head_sha })) ||
            evidence.complete !== true || !['unknown','pending','passed','failed'].includes(evidence.checks) || !Array.isArray(evidence.decisions) || evidence.decisions.length > 256) fail();
        const observed = time(evidence.observed_at), until = time(evidence.valid_until);
        if (observed > now || until <= now || until <= observed || until-observed > 600_000) fail();
        const normalizedEvents = evidence.decisions.map(event => {
          if (!ownKeys(event,['event_id','user_id','head_sha','state','occurred_at']) || !identifier(event.event_id) || !identifier(event.user_id) ||
              event.head_sha !== target.head_sha || !['approved','changes_requested','revoked'].includes(event.state) || time(event.occurred_at) > observed) fail();
          return { event_id:event.event_id, user_id:event.user_id, head_sha:event.head_sha, state:event.state, occurred_at:event.occurred_at };
        });
        const scope = JSON.stringify([target.repository,target.pull_request_number]);
        const seenIds = new Set();
        for (const event of normalizedEvents) {
          if (seenIds.has(event.event_id)) fail();
          seenIds.add(event.event_id);
          const key = JSON.stringify([scope,event.event_id]);
          if (events.has(key) && events.get(key) !== digest(event)) fail();
        }
        const hash = digest({ ...evidence, decisions:normalizedEvents });
        const previous = observations.get(scope);
        if (previous && (observed < previous.observed || (observed === previous.observed && hash !== previous.hash))) fail();
        const latestByUser = new Map();
        for (const event of normalizedEvents) {
          const old = latestByUser.get(event.user_id);
          if (old && event.occurred_at === old.occurred_at && event.state !== old.state) fail();
          if (!old || event.occurred_at > old.occurred_at) latestByUser.set(event.user_id,event);
        }
        let decision;
        for (const event of latestByUser.values()) {
          if (typeof authorizeUser !== 'function' || await authorizeUser(event.user_id, target) !== true) continue;
          if (!decision || event.occurred_at > decision.occurred_at) decision=event;
        }
        // Check revision after all potentially asynchronous policy work.
        const head = targetIdentity(await adapter.readHead(target));
        const finalNow = clock();
        if (!sameTarget(target,head) || !Number.isSafeInteger(finalNow) || finalNow < observed || finalNow >= until) fail();
        // Another evaluation may have advanced evidence while callbacks awaited.
        const latest = observations.get(scope);
        if (latest && (observed < latest.observed || (observed === latest.observed && hash !== latest.hash))) fail();
        for (const event of normalizedEvents) {
          const key=JSON.stringify([scope,event.event_id]);
          if (events.has(key) && events.get(key)!==digest(event)) fail();
        }
        // Complete observations cannot omit or regress a decision already seen
        // for this exact revision/user. In particular, a newer response must
        // not replay an old approval after remembering its revocation.
        const revision = JSON.stringify([scope,target.head_sha]);
        const remembered = latestDecisions.get(revision);
        for (const [userId, old] of remembered ?? []) {
          const incoming = latestByUser.get(userId);
          if (!incoming || time(incoming.occurred_at) < time(old.occurred_at) ||
              (incoming.occurred_at === old.occurred_at && digest(incoming) !== digest(old))) fail();
        }
        const newKeys = normalizedEvents.map(event => JSON.stringify([scope,event.event_id])).filter(key => !events.has(key));
        if (events.size + newKeys.length > 256 || (!previous && observations.size >= 128)) fail();
        for (const event of normalizedEvents) events.set(JSON.stringify([scope,event.event_id]),digest(event));
        observations.set(scope,{ observed, hash });
        if (latestByUser.size > 0) latestDecisions.set(revision,latestByUser);
        return { ...unknown('preview_only'), candidate: { ...target, checks:evidence.checks, decision:decision?.state ?? 'unknown',
          user_id:decision?.user_id ?? null, event_id:decision?.event_id ?? null } };
      } catch {
        return unknown('evidence_unavailable'); // Never expose arbitrary adapter errors.
      }
    },
  });
}
