import { ControlPlaneError } from './errors.js';

// Keep config loading and passive clone diagnostics independent of npm packages.
const identifier = value => typeof value === 'string' && value.length <= 64 &&
  /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
const fieldsOnly = (value, fields) => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.keys(value).every(key => fields.includes(key));
const invalid = () => { throw new ControlPlaneError('invalid_config', 'Invalid executionNodes configuration'); };

export function normalizeExecutionNodes(config = {}) {
  if (!fieldsOnly(config, ['enabled', 'nodes'])) invalid();
  const enabled = config.enabled === undefined ? false : config.enabled;
  const nodes = config.nodes === undefined ? [] : config.nodes;
  if (typeof enabled !== 'boolean' || !Array.isArray(nodes) || nodes.length > 64) invalid();
  const seen = new Set();
  const normalized = nodes.map(node => {
    if (!fieldsOnly(node, ['id', 'kind', 'authorized', 'executor_ids']) || !identifier(node.id) ||
        seen.has(node.id) || !['local', 'cloud'].includes(node.kind)) invalid();
    seen.add(node.id);
    const authorized = node.authorized === undefined ? false : node.authorized;
    const ids = node.executor_ids;
    if (typeof authorized !== 'boolean' || !Array.isArray(ids) || ids.length > 16 ||
        !ids.every(identifier) || new Set(ids).size !== ids.length) invalid();
    return Object.freeze({id:node.id,kind:node.kind,authorized,executor_ids:Object.freeze([...ids])});
  });
  return Object.freeze({enabled,nodes:Object.freeze(normalized)});
}
