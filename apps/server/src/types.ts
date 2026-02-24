// Internal backend-only runtime structures.
// All protocol-level types come from @ai-party/protocol.

import type { Priority, ReasonCode } from '@ai-party/protocol'

export interface HandEntry {
  event_id: string          // original raise_hand event_id
  sender_id: string
  intent: string
  priority: Priority
  reason_code: ReasonCode
  reply_to?: string | undefined
  enqueued_at: number          // ms, for wait_bonus calc
  score: number          // computed by orchestrator
}

export interface Token {
  token_id: string
  holder: string
  issued_at: number
  ttl_sec: number
  timer: ReturnType<typeof setTimeout>
}

export interface SpeakRecord {
  agent_id: string
  at: number             // ms
}

export interface AgentStats {
  speak_times: number[]        // ms timestamps, rolling window
}
