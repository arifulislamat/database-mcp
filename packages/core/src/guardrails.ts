/**
 * Guardrail defaults (PRD §8). Every engine package inherits these from
 * core; adapters must not hardcode their own defaults.
 */
export interface Guardrails {
  readOnly: boolean;
  maxRows: number;
  queryTimeoutMs: number;
}

export const DEFAULT_GUARDRAILS: Guardrails = {
  readOnly: true,
  maxRows: 1000,
  queryTimeoutMs: 30000,
};
