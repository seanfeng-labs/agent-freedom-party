import type { Priority, ReasonCode } from "@ai-party/protocol"

export interface RaiseHandConfig {
  priority: Priority
  reason_code: ReasonCode
}

export interface HostConfig {
  sender_id: string
  name: string
  system_prompt: string
}

export interface AgentConfig {
  sender_id: string
  name: string
  system_prompt: string
  raise_hand_config: RaiseHandConfig
}

export interface AgentsConfig {
  backend_url: string
  topic: string
  host: HostConfig
  agents: AgentConfig[]
  /** How many discussion rounds to run */
  rounds: number
  /** Delay between each agent's raise_hand in a round (ms) */
  round_delay_ms: number
}
