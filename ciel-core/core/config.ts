// Core configuration (spec §10, §11, §12).
// AI is OFF by default. Enabling it requires an explicit provider; single_provider forbids fallbacks.
import { CielError, DegradationLevel } from './types.ts';

export const DEFAULT_CONFIG = Object.freeze({
  ai: Object.freeze({ enabled: false, mode: 'single_provider', provider: null, model: null, fallback: 'none' }),
  budget: Object.freeze({
    default_limits: Object.freeze({ time_ms: 10 * 60 * 1000, tool_calls: 200, ai_calls: 0, tokens: 0, money: 0 }),
    soft_threshold: 0.8,
  }),
  policy: Object.freeze({
    default_permissions: Object.freeze([]),
    require_confirmation_for_irreversible: true,
    loop_threshold: 3,
    max_reframes_per_mission: 3,
  }),
});

function merge(base, over) {
  if (!over || typeof over !== 'object') return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
      ? merge(base[k], v) : v;
  }
  return out;
}

export function createConfig(overrides = {}) {
  const cfg = merge(DEFAULT_CONFIG, overrides);
  if (cfg.ai.enabled && !cfg.ai.provider) {
    throw new CielError('INVALID_CONFIG', 'ai.enabled=true requires ai.provider');
  }
  if (cfg.ai.mode === 'single_provider' && cfg.ai.fallback !== 'none') {
    throw new CielError('INVALID_CONFIG', 'single_provider mode forbids any fallback provider');
  }
  return cfg;
}

// FULL: AI configured and reachable. REDUCED: configured but unavailable. CORE_ONLY: AI disabled.
export function degradationLevel(config, providerAvailable) {
  if (!config.ai.enabled) return DegradationLevel.CORE_ONLY;
  return providerAvailable ? DegradationLevel.FULL : DegradationLevel.REDUCED;
}