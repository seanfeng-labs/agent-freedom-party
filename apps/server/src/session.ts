import { randomUUID } from 'node:crypto'
import type { SessionState, PartyEvent } from '@ai-party/protocol'
import type { Token, AgentStats, SpeakRecord } from './types'
import { HandQueue } from './heap'

// ─── Config ───────────────────────────────────────────────────────────────────

export const CONFIG = {
  token_ttl_sec: 30,
  per_agent_rate_limit: 3,        // max speaks per 60s
  rate_window_ms: 60_000,
  cooldown_duration_ms: 5_000,
  dominance_window_ms: 60_000,
  dominance_threshold: 2,        // speaks in window before penalty kicks in
} as const

// ─── Session ──────────────────────────────────────────────────────────────────

export class Session {
  readonly session_id: string
  readonly created_at: number

  state: SessionState = 'idle'
  topic: string | null = null

  current_token: Token | null = null

  readonly hand_queue = new HandQueue()
  readonly event_log: PartyEvent[] = []
  readonly speak_history: SpeakRecord[] = []

  private agent_stats = new Map<string, AgentStats>()
  private cooldown_timer: ReturnType<typeof setTimeout> | null = null

  pending_user_message: PartyEvent | null = null

  constructor(session_id?: string) {
    this.session_id = session_id ?? randomUUID()
    this.created_at = Date.now()
  }

  // ── State transitions ──────────────────────────────────────────────────────

  open(topic: string): void {
    if (this.state !== 'idle') throw new Error(`Cannot open: state is ${this.state}`)
    this.topic = topic
    this.state = 'active'
  }

  enterCooldown(onResume: () => void): void {
    if (this.state !== 'active') return
    this.state = 'cooldown'
    this.cooldown_timer = setTimeout(() => {
      if (this.state === 'cooldown') {
        this.state = 'active'
        onResume()
      }
    }, CONFIG.cooldown_duration_ms)
  }

  exitCooldown(): void {
    if (this.cooldown_timer) {
      clearTimeout(this.cooldown_timer)
      this.cooldown_timer = null
    }
    if (this.state === 'cooldown') this.state = 'active'
  }

  startClosing(): void {
    if (this.state === 'closed') return
    this.releaseToken()
    this.state = 'closing'
  }

  close(): void {
    this.state = 'closed'
  }

  // ── Token management ───────────────────────────────────────────────────────

  issueToken(holder: string, ttl_sec: number, onExpire: (token_id: string) => void): Token {
    this.releaseToken()

    const token_id = randomUUID()
    const timer = setTimeout(() => onExpire(token_id), ttl_sec * 1000)

    this.current_token = { token_id, holder, issued_at: Date.now(), ttl_sec, timer }
    return this.current_token
  }

  releaseToken(): Token | null {
    const t = this.current_token
    if (t) {
      clearTimeout(t.timer)
      this.current_token = null
    }
    return t
  }

  validateToken(token_id: string, sender_id: string): boolean {
    const t = this.current_token
    if (!t) return false
    if (t.token_id !== token_id) return false
    if (t.holder !== sender_id) return false
    return (Date.now() - t.issued_at) / 1000 < t.ttl_sec
  }

  // ── Agent stats ────────────────────────────────────────────────────────────

  recordSpeak(agent_id: string): void {
    const stats = this.getStats(agent_id)
    const now = Date.now()
    stats.speak_times.push(now)
    this.speak_history.push({ agent_id, at: now })
    stats.speak_times = stats.speak_times.filter(t => now - t < CONFIG.rate_window_ms)
  }

  isRateLimited(agent_id: string): boolean {
    const stats = this.getStats(agent_id)
    const now = Date.now()
    const recent = stats.speak_times.filter(t => now - t < CONFIG.rate_window_ms)
    return recent.length >= CONFIG.per_agent_rate_limit
  }

  dominancePenalty(agent_id: string): number {
    const now = Date.now()
    const recent = this.speak_history.filter(
      r => r.agent_id === agent_id && now - r.at < CONFIG.dominance_window_ms
    )
    const excess = recent.length - CONFIG.dominance_threshold
    if (excess <= 0) return 0
    return Math.min(excess * 20, 60)
  }

  private getStats(agent_id: string): AgentStats {
    if (!this.agent_stats.has(agent_id)) {
      this.agent_stats.set(agent_id, { speak_times: [] })
    }
    return this.agent_stats.get(agent_id)!
  }

  // ── Event log ──────────────────────────────────────────────────────────────

  log(event: PartyEvent): void {
    this.event_log.push(event)
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  destroy(): void {
    this.releaseToken()
    if (this.cooldown_timer) {
      clearTimeout(this.cooldown_timer)
      this.cooldown_timer = null
    }
  }
}

// ─── SessionManager ───────────────────────────────────────────────────────────

export class SessionManager {
  private sessions = new Map<string, Session>()

  create(session_id?: string): Session {
    const s = new Session(session_id)
    this.sessions.set(s.session_id, s)
    return s
  }

  get(session_id: string): Session | undefined {
    return this.sessions.get(session_id)
  }

  getOrCreate(session_id: string): Session {
    let s = this.sessions.get(session_id)
    if (!s) {
      s = new Session(session_id)
      this.sessions.set(session_id, s)
    }
    return s
  }

  list(): Session[] {
    return Array.from(this.sessions.values())
  }

  destroy(session_id: string): boolean {
    const s = this.sessions.get(session_id)
    if (!s) return false
    s.destroy()
    this.sessions.delete(session_id)
    return true
  }

  get size(): number {
    return this.sessions.size
  }
}

export const sessionManager = new SessionManager()

// Backwards compat: default session for legacy single-session usage
export const SESSION_ID = 'default'
export const session = sessionManager.getOrCreate(SESSION_ID)
