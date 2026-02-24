import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'
import { parsePartyEvent } from '@ai-party/protocol'
import type {
  PartyEvent,
  Priority,
  ReasonCode,
  InterruptMode,
  SessionState,
} from '@ai-party/protocol'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionSnapshot {
  type: 'session_snapshot'
  session_id: string
  state: SessionState
  topic: string | null
  current_token: { holder: string; token_id: string } | null
  queue_size: number
  event_log_length: number
}

export interface AgentClientOptions {
  url: string
  sender_id: string
  sender_role: 'user' | 'host_agent' | 'role_agent'
  /** Called for every inbound event (after internal routing). */
  onEvent?: (event: PartyEvent) => void
  /** Called when connection closes. */
  onClose?: (code: number, reason: string) => void
  /** Called on connection error. */
  onError?: (err: Error) => void
}

export interface RaiseHandOptions {
  intent: string
  priority: Priority
  reason_code: ReasonCode
  reply_to?: string
}

export interface HandAcceptedResult {
  token_id: string
  holder: string
  ttl_sec: number
}

export interface HandRejectedResult {
  reason: 'duplicate' | 'off_topic' | 'rate_limit' | 'session_closing' | 'no_active_session'
  original_raise_hand_id: string
}

// ─── AgentClient ──────────────────────────────────────────────────────────────

export class AgentClient {
  private ws: WebSocket
  private readonly sender_id: string
  private readonly sender_role: 'user' | 'host_agent' | 'role_agent'
  private readonly onEvent?: (event: PartyEvent) => void

  // Pending one-shot resolvers keyed by event_type + optional discriminator
  private waiters = new Map<string, Array<(event: PartyEvent) => void>>()

  // Snapshot received on connect
  private _snapshot: SessionSnapshot | null = null

  private constructor(
    ws: WebSocket,
    opts: AgentClientOptions,
  ) {
    this.ws = ws
    this.sender_id = opts.sender_id
    this.sender_role = opts.sender_role
    this.onEvent = opts.onEvent

    ws.on('message', (raw) => {
      let parsed: unknown
      try { parsed = JSON.parse(raw.toString()) } catch { return }

      // session_snapshot is not a PartyEvent — handle separately
      const msg = parsed as Record<string, unknown>
      if (msg['type'] === 'session_snapshot') {
        this._snapshot = parsed as SessionSnapshot
        this.notify('session_snapshot', parsed as PartyEvent)
        return
      }
      if (msg['type'] === 'error') {
        this.notify('error', parsed as PartyEvent)
        return
      }

      let event: PartyEvent
      try { event = parsePartyEvent(parsed) } catch { return }

      this.onEvent?.(event)
      this.notify(event.event_type, event)

      // For hand_accepted / hand_rejected, also notify on the raise_hand's event_id
      if (event.event_type === 'hand_accepted' || event.event_type === 'hand_rejected') {
        const id = (event.payload as Record<string, unknown>)['original_raise_hand_id'] as string | undefined
        if (id) this.notify(`raise_hand_result:${id}`, event)
        // Also notify by holder so raiseHand() can wait for its own accepted
        if (event.event_type === 'hand_accepted') {
          const holder = (event.payload as Record<string, unknown>)['holder'] as string
          this.notify(`hand_accepted:${holder}`, event)
        }
      }
    })

    ws.on('error', (err) => opts.onError?.(err))
    ws.on('close', (code, reason) => opts.onClose?.(code, reason.toString()))
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  static connect(opts: AgentClientOptions): Promise<AgentClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(opts.url)
      const client = new AgentClient(ws, opts)

      ws.once('open', () => {
        // Wait for snapshot before resolving
        client.waitForRaw<SessionSnapshot>('session_snapshot', 5000)
          .then(() => resolve(client))
          .catch(reject)
      })
      ws.once('error', reject)
    })
  }

  // ── Low-level ──────────────────────────────────────────────────────────────

  private send(
    event_type: string,
    payload: Record<string, unknown>,
    extra: Partial<PartyEvent> = {}
  ): string {
    const event_id = randomUUID()
    this.ws.send(JSON.stringify({
      event_id,
      sender_id: this.sender_id,
      sender_role: this.sender_role,
      event_type,
      payload,
      ...extra,
    }))
    return event_id
  }

  private notify(key: string, event: PartyEvent): void {
    const list = this.waiters.get(key)
    if (!list?.length) return
    const fn = list.shift()!
    if (list.length === 0) this.waiters.delete(key)
    fn(event)
  }

  private waitForRaw<T>(key: string, timeout = 10_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const list = this.waiters.get(key)
        if (list) {
          const idx = list.indexOf(fn)
          if (idx !== -1) list.splice(idx, 1)
        }
        reject(new Error(`AgentClient: waitFor "${key}" timed out after ${timeout}ms`))
      }, timeout)

      const fn = (event: PartyEvent) => {
        clearTimeout(timer)
        resolve(event as unknown as T)
      }

      if (!this.waiters.has(key)) this.waiters.set(key, [])
      this.waiters.get(key)!.push(fn)
    })
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  get snapshot(): SessionSnapshot | null { return this._snapshot }
  get id(): string { return this.sender_id }

  // ── Protocol methods ───────────────────────────────────────────────────────

  /**
   * (user) Open a new topic. Returns the echoed topic_open event.
   */
  topicOpen(topic: string): Promise<PartyEvent> {
    this.send('topic_open', { topic })
    return this.waitForRaw('topic_open')
  }

  /**
   * (role_agent / host_agent) Raise hand and wait for the orchestrator's
   * hand_accepted or hand_rejected response for this specific raise.
   *
   * Returns { accepted: true, token_id, ttl_sec } or { accepted: false, reason }.
   */
  raiseHand(opts: RaiseHandOptions): Promise<
    | { accepted: true } & HandAcceptedResult
    | { accepted: false } & HandRejectedResult
  > {
    const event_id = this.send('raise_hand', {
      intent: opts.intent,
      priority: opts.priority,
      reason_code: opts.reason_code,
      ...(opts.reply_to ? { reply_to: opts.reply_to } : {}),
    })

    return new Promise((resolve, reject) => {
      const key = `raise_hand_result:${event_id}`
      const holderKey = `hand_accepted:${this.sender_id}`
      const timeout = 10_000

      let settled = false
      const settle = (event: PartyEvent) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        // Clean up the other waiter
        const other = event.event_type === 'hand_accepted' ? key : holderKey
        const list = this.waiters.get(other)
        if (list) {
          const idx = list.indexOf(holderFn)
          if (idx !== -1) list.splice(idx, 1)
        }

        if (event.event_type === 'hand_accepted') {
          const p = event.payload as Record<string, unknown>
          resolve({ accepted: true, token_id: p['token_id'] as string, holder: p['holder'] as string, ttl_sec: p['ttl_sec'] as number })
        } else if (event.event_type === 'hand_rejected') {
          const p = event.payload as Record<string, unknown>
          resolve({ accepted: false, reason: p['reason'] as HandRejectedResult['reason'], original_raise_hand_id: p['original_raise_hand_id'] as string })
        }
      }

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error(`AgentClient.raiseHand timed out`))
      }, timeout)

      // Listen on raise_hand_result (server echoes original_raise_hand_id)
      // AND on hand_accepted:holder (for when server dispatches from queue later)
      const holderFn = (e: PartyEvent) => settle(e)
      if (!this.waiters.has(key)) this.waiters.set(key, [])
      if (!this.waiters.has(holderKey)) this.waiters.set(holderKey, [])
      this.waiters.get(key)!.push(settle)
      this.waiters.get(holderKey)!.push(holderFn)
    })
  }

  /**
   * (role_agent) Speak using a held token.
   */
  speak(token_id: string, text: string): Promise<PartyEvent> {
    this.send('speak', { token_id, text })
    return this.waitForRaw('speak')
  }

  /**
   * (role_agent) Yield the current token.
   */
  yieldToken(token_id: string): Promise<PartyEvent> {
    this.send('yield_token', { token_id })
    return this.waitForRaw('yield_token')
  }

  /**
   * Convenience: raise hand → speak → yield in one call.
   * Resolves after yield_token is confirmed.
   * Returns undefined if hand was rejected.
   */
  async speakWhenReady(
    opts: RaiseHandOptions,
    getText: (token_id: string) => string | Promise<string>
  ): Promise<{ token_id: string; text: string } | null> {
    const result = await this.raiseHand(opts)
    if (!result.accepted) return null

    const { token_id } = result
    const text = await getText(token_id)
    await this.speak(token_id, text)
    await this.yieldToken(token_id)
    return { token_id, text }
  }

  /**
   * (user) Send a user message with optional interrupt mode.
   */
  userMessage(text: string, interrupt_mode: InterruptMode = 'soft'): void {
    this.send('user_message', { text, interrupt_mode })
  }

  /**
   * (user) Retarget — boost a specific agent's queue score.
   */
  retarget(agent_id: string): void {
    this.send('retarget', { agent_id })
  }

  /**
   * (any) Request to interrupt the current speaker.
   */
  interruptRequest(reason: string, target_token_id: string): Promise<PartyEvent> {
    this.send('interrupt_request', { reason, target_token_id })
    return this.waitForRaw('interrupt_granted')
  }

  /**
   * (user) Request session close.
   */
  closeRequest(need?: string): void {
    this.send('close_request', { ...(need ? { need } : {}) })
  }

  /**
   * (host_agent) Publish final summary and close the session.
   */
  finalSummary(conclusion: string, actions: string[], divergences?: string[]): Promise<PartyEvent> {
    this.send('final_summary', {
      conclusion,
      actions,
      ...(divergences ? { divergences } : {}),
    })
    return this.waitForRaw('final_summary')
  }

  /**
   * Subscribe to a specific event type. Returns an unsubscribe function.
   */
  on(event_type: string, handler: (event: PartyEvent) => void): () => void {
    const wrapped = (event: PartyEvent) => {
      handler(event)
      // Re-register so it fires again next time
      if (!this.waiters.has(event_type)) this.waiters.set(event_type, [])
      this.waiters.get(event_type)!.push(wrapped)
    }
    if (!this.waiters.has(event_type)) this.waiters.set(event_type, [])
    this.waiters.get(event_type)!.push(wrapped)

    return () => {
      const list = this.waiters.get(event_type)
      if (!list) return
      const idx = list.indexOf(wrapped)
      if (idx !== -1) list.splice(idx, 1)
    }
  }

  /**
   * Wait for the next occurrence of an event type (one-shot).
   */
  waitFor(event_type: string, timeout = 10_000): Promise<PartyEvent> {
    return this.waitForRaw(event_type, timeout)
  }

  /**
   * Close the WS connection.
   */
  close(): void {
    this.ws.close()
  }
}
