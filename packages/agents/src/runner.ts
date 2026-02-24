import type { AgentsConfig } from './types'

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function run(config: AgentsConfig): Promise<void> {
  const { backend_url, topic, host: hostCfg, agents: agentCfgs, rounds, round_delay_ms } = config

  console.log(backend_url, topic, hostCfg, agentCfgs, rounds, round_delay_ms);
}
