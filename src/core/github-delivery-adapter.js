import { createHash } from 'node:crypto';

const unavailable = () => new Error('GitHub delivery unavailable');
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const repo = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 80 && !/[\x00-\x1f\x7f]/.test(value);
const header = (headers, name) => typeof headers?.get === 'function' ? headers.get(name) : headers?.[name] ?? headers?.[name[0].toUpperCase()+name.slice(1)];

// Trusted host transport contract: request(url,{method,redirect,cache,signal,headers})
// returns {status,url,headers,body:string,redirected?:boolean}. The transport must
// honor redirect:'error', TLS verification and abort, and must not follow links
// itself. Credentials, if authorized later, belong to that transport, never here.
// No default fetch, auth discovery, user acceptance mapper or production wiring.
export function createGitHubDeliveryAdapter({ request, repository, requiredChecks = [], clock = Date.now,
  ttlMs = 60_000, maxPages = 10, maxRecords = 1000, maxBytes = 262144, timeoutMs = 5000 } = {}) {
  if (!repo(repository) || !Array.isArray(requiredChecks) || requiredChecks.length > 64 ||
      requiredChecks.some(check => !check || !text(check.name) || !Number.isSafeInteger(check.app_id) || check.app_id < 1 || Object.keys(check).some(key => !['name','app_id'].includes(key))) ||
      new Set(requiredChecks.map(check => JSON.stringify([check.name,check.app_id]))).size !== requiredChecks.length ||
      ![[ttlMs,1000,600000],[maxPages,1,20],[maxRecords,1,2000],[maxBytes,1024,1048576],[timeoutMs,10,30000]]
        .every(([value,min,max]) => Number.isInteger(value) && value >= min && value <= max)) throw unavailable();
  const base = `https://api.github.com/repos/${repository}`;
  function target(input) {
    if (!input || input.repository !== repository || !Number.isSafeInteger(input.pull_request_number) ||
        input.pull_request_number < 1 || !sha(input.head_sha) ||
        Object.keys(input).some(key => !['repository','pull_request_number','head_sha'].includes(key))) throw unavailable();
    return { repository, pull_request_number:input.pull_request_number, head_sha:input.head_sha };
  }
  function now() {
    const ms = clock();
    if (!Number.isSafeInteger(ms) || ms < 0 || ms + ttlMs >= 8.64e15) throw unavailable();
    return ms;
  }
  async function get(url, budget) {
    if (typeof request !== 'function') throw unavailable();
    const controller = new AbortController();
    let timer;
    try {
      const response = await Promise.race([
        Promise.resolve().then(() => request(url, { method:'GET', redirect:'error', cache:'no-store', signal:controller.signal,
          headers:{ accept:'application/vnd.github+json' } })),
        new Promise((_,reject) => { timer=setTimeout(() => { controller.abort(); reject(unavailable()); },timeoutMs); }),
      ]);
      if (!response || response.status !== 200 || response.url !== url || response.redirected === true || typeof response.body !== 'string') throw unavailable();
      budget.bytes += Buffer.byteLength(response.body,'utf8');
      if (budget.bytes > maxBytes) throw unavailable();
      return { data:JSON.parse(response.body), headers:response.headers };
    } finally { clearTimeout(timer); }
  }
  function validatePr(value, expected) {
    if (!value || value.number !== expected.pull_request_number ||
        value.base?.repo?.full_name !== repository || value.head?.sha !== expected.head_sha || typeof value.merged !== 'boolean') throw unavailable();
    return value;
  }
  function mergedFact(value, observed) {
    if (!value.merged) {
      if (value.merged_at !== null) throw unavailable();
      return {merged:false,merge_commit_sha:null,event_id:null,source:'github',occurred_at:null};
    }
    const occurred=Date.parse(value.merged_at);
    if (typeof value.merged_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.merged_at) ||
        !Number.isFinite(occurred) || new Date(occurred).toISOString() !== (value.merged_at.includes('.') ? value.merged_at : value.merged_at.replace('Z','.000Z')) ||
        occurred > observed || !sha(value.merge_commit_sha)) throw unavailable();
    return {merged:true,merge_commit_sha:value.merge_commit_sha,
      event_id:'merge-'+createHash('sha256').update(JSON.stringify([repository,value.number,value.head.sha,value.merge_commit_sha,occurred])).digest('hex'),
      source:'github',occurred_at:new Date(occurred).toISOString()};
  }
  function nextPage(headers, path, page) {
    const link = header(headers,'link');
    if (link == null || link === '') return null;
    if (typeof link !== 'string' || link.length > 8000) throw unavailable();
    const next = link.split(',').filter(part => /;\s*rel="next"(?:\s*;|\s*$)/.test(part));
    if (next.length === 0) return null;
    if (next.length !== 1) throw unavailable();
    const match = next[0].trim().match(/^<([^>]+)>;/);
    if (!match) throw unavailable();
    const url = new URL(match[1]);
    if (url.origin !== 'https://api.github.com' || url.pathname !== path || url.username || url.password || url.hash ||
        [...url.searchParams.keys()].some(key => !['per_page','page'].includes(key)) ||
        url.searchParams.getAll('page').length !== 1 || url.searchParams.getAll('per_page').length !== 1 ||
        url.searchParams.get('per_page') !== '100' || url.searchParams.get('page') !== String(page+1)) throw unavailable();
    return url.href;
  }
  async function checks(expected,budget) {
    if (!requiredChecks.length) return 'unknown';
    const path=`/repos/${repository}/commits/${expected.head_sha}/check-runs`;
    let url=`https://api.github.com${path}?per_page=100&page=1`, count, page=0;
    const seen = new Map();
    do {
      if (++page > maxPages) throw unavailable();
      const {data,headers}=await get(url,budget);
      if (!Number.isSafeInteger(data?.total_count) || data.total_count < 0 || data.total_count > maxRecords ||
          !Array.isArray(data.check_runs) || data.check_runs.length > 100 || (count !== undefined && count !== data.total_count)) throw unavailable();
      count=data.total_count;
      for (const run of data.check_runs) {
        if (!run || !Number.isSafeInteger(run.id) || run.id < 1 || seen.has(run.id) || !text(run.name) || run.head_sha !== expected.head_sha ||
            !Number.isSafeInteger(run.app?.id) || run.app.id < 1 ||
            !['queued','in_progress','completed','waiting','pending','requested'].includes(run.status) ||
            !(run.conclusion === null || ['success','failure','neutral','cancelled','skipped','timed_out','action_required','stale','startup_failure'].includes(run.conclusion))) throw unavailable();
        seen.set(run.id,run);
        if (seen.size > maxRecords) throw unavailable();
      }
      url=nextPage(headers,path,page);
    } while (url);
    if (seen.size !== count) throw unavailable();
    const selected=requiredChecks.map(check => [...seen.values()].filter(run => run.name === check.name && run.app.id === check.app_id).sort((a,b) => b.id-a.id)[0]);
    if (selected.some(run => !run)) return 'unknown';
    if (selected.some(run => run.status === 'completed' && ['failure','cancelled','timed_out','action_required','stale','startup_failure'].includes(run.conclusion))) return 'failed';
    if (selected.some(run => run.status !== 'completed')) return 'pending';
    return selected.every(run => run.conclusion === 'success') ? 'passed' : 'unknown';
  }
  return Object.freeze({
    async readHead(input) {
      try {
        const expected=target(input);
        validatePr((await get(`${base}/pulls/${expected.pull_request_number}`,{bytes:0})).data,expected);
        return expected;
      } catch { throw unavailable(); }
    },
    async readObservation(input) {
      try {
        const expected=target(input), budget={bytes:0};
        const url=`${base}/pulls/${expected.pull_request_number}`;
        const before=validatePr((await get(url,budget)).data,expected);
        const result=await checks(expected,budget);
        const after=validatePr((await get(url,budget)).data,expected);
        const observed=now();
        const merge=mergedFact(after,observed);
        if (JSON.stringify(mergedFact(before,observed)) !== JSON.stringify(merge)) throw unavailable();
        return {...expected,checks:result,complete:true,observed_at:new Date(observed).toISOString(),
          valid_until:new Date(observed+ttlMs).toISOString(),decisions:[],merge};
      } catch { throw unavailable(); }
    },
  });
}
