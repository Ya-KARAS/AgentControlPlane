import { createDeliveryEvidenceEvaluator } from './delivery-evidence.js';

// Trusted process composition only. No credential, policy or transport is
// inferred from config or request JSON. This is not a network authentication API.
export function createDeliveryHostService({ adapter, authorizeUser, clock = Date.now, read, commit, healthy }) {
  const active = adapter && typeof adapter.readObservation === 'function' && typeof adapter.readHead === 'function';
  const projections = new Map();
  const pending = new Map();
  const stamp = value => JSON.stringify(value);
  const unknown = delivery => delivery ? { ...delivery, checks:'unknown', review_state:'unknown', approval_supported:false,merged:null,merge_commit_sha:null,merge_source:null,merge_event_id:null } : null;
  function status(id) {
    const state=read(id), projection=projections.get(id);
    let now;
    try { now=clock(); } catch { return unknown(state?.delivery); }
    if (!healthy() || !projection || !Number.isSafeInteger(now) || now < projection.observed || now >= projection.until || projection.stamp !== stamp(state?.delivery)) return unknown(state?.delivery);
    return { ...state.delivery, checks:projection.checks, review_state:projection.review, source:'verified_host', verification:'verified', verified_until:new Date(projection.until).toISOString(), approval_supported:typeof authorizeUser === 'function',merged:projection.merge?.merged ?? null,merge_commit_sha:projection.merge?.merge_commit_sha ?? null,merge_source:projection.merge?.source ?? null,merge_event_id:projection.merge?.event_id ?? null };
  }
  return Object.freeze({ status,
    async refresh(id) {
      projections.delete(id); // No cached approval across any failed refresh.
      const previous=pending.get(id) ?? Promise.resolve();
      const operation=previous.catch(()=>{}).then(async()=>{
        projections.delete(id);
        if (!active || !healthy()) return status(id);
        try {
          const state=read(id), delivery=state?.delivery;
          if (!delivery?.repository || !delivery.pull_request_number || !delivery.head_sha) return status(id);
          if (state.journal !== undefined && (!state.journal || state.journal.version !== 1 || Object.keys(state.journal).some(k=>!['version','history'].includes(k)))) return status(id);
          const evaluator=createDeliveryEvidenceEvaluator({adapter,authorizeUser,clock,history:state.journal?.history});
          const target={repository:delivery.repository,pull_request_number:delivery.pull_request_number,head_sha:delivery.head_sha};
          const result=await evaluator.evaluate(target);
          if (!result.candidate || !healthy() || stamp(read(id)?.delivery) !== stamp(delivery)) return status(id);
          const journal={version:1,history:evaluator.exportHistory()};
          commit(id,journal,stamp(delivery),result.candidate.merge); // No async yield between binding and persist.
          const now=clock(), observed=Date.parse(result.validity.observed_at), until=Date.parse(result.validity.valid_until);
          if (!Number.isSafeInteger(now) || now < observed || now >= until || !healthy()) return status(id);
          projections.set(id,{stamp:stamp(delivery),observed,until,checks:result.candidate.checks,merge:result.candidate.merge,
            review:result.candidate.decision === 'approved' ? 'approved' : result.candidate.decision === 'changes_requested' ? 'changes_requested' : result.candidate.decision === 'revoked' ? 'pending_review' : 'unknown'});
          return status(id);
        } catch { projections.delete(id); return status(id); }
      });
      pending.set(id,operation);
      try { return await operation; } finally { if (pending.get(id) === operation) pending.delete(id); }
    },
  });
}
