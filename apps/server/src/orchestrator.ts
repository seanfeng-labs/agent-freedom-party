import { randomUUID } from 'node:crypto'
import type {
  PartyEvent,
  TopicOpenEvent,
  RaiseHandEvent,
  HandAcceptedEvent,
  HandRejectedEvent,
  SpeakEvent,
  YieldTokenEvent,
  InterruptRequestEvent,
  InterruptGrantedEvent,
  UserMessageEvent,
  RetargetEvent,
  CloseRequestEvent,
  FinalSummaryEvent,
} from '@ai-party/protocol'
import type { HandEntry } from './types'
import type { Session } from './session'
import { CONFIG } from './session'

// ─── Weights ──────────────────────────────────────────────────────────────────

const PRIORITY_WEIGHT = { high: 100, medium: 60, low: 30 } as const
const WAIT_BONUS_CAP = 30
const MENTION_BONUS_USER = 40
const MENTION_BONUS_AGENT = 15

// ─── Orchestrator (per-session) ───────────────────────────────────────────────

export class Orchestrator {
  private broadcastFn: ((event: PartyEvent) => void) | null = null
  readonly session: Session

  constructor(session: Session) {
    this.session = session
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private makeEvent<T extends PartyEvent>(
    partial: Omit<T, 'event_id' | 'session_id' | 'timestamp'>
  ): T {
    return {
      event_id: randomUUID(),
      session_id: this.session.session_id,
      timestamp: Date.now(),
      ...partial,
    } as T
  }

  private computeScore(
    entry: Pick<HandEntry, 'sender_id' | 'priority' | 'enqueued_at'>,
    mention_bonus = 0
  ): number {
    const priority_weight = PRIORITY_WEIGHT[entry.priority]
    const wait_sec = (Date.now() - entry.enqueued_at) / 1000
    const wait_bonus = Math.min(wait_sec, WAIT_BONUS_CAP)
    const dominance_penalty = this.session.dominancePenalty(entry.sender_id)
    return priority_weight + wait_bonus + mention_bonus - dominance_penalty
  }

  // ── Broadcast ──────────────────────────────────────────────────────────────

  setBroadcast(fn: (event: PartyEvent) => void): void {
    this.broadcastFn = fn
  }

  private broadcast(event: PartyEvent): void {
    this.session.log(event)
    this.broadcastFn?.(event)
  }

  // ── Token expiry ───────────────────────────────────────────────────────────

  private onTokenExpired = (token_id: string): void => {
    if (this.session.current_token?.token_id !== token_id) return
    this.session.releaseToken()
    this.dispatchNext()
  }

  // ── Dispatch next ──────────────────────────────────────────────────────────

  dispatchNext(): void {
    if (this.session.state !== 'active') return
    if (this.session.current_token) return
    if (this.session.hand_queue.size === 0) return

    // Re-score all (wait_bonus grows over time)
    const entries = this.session.hand_queue.toArray()
    this.session.hand_queue.remove(() => true)
    for (const e of entries) {
      e.score = this.computeScore(e)
      this.session.hand_queue.push(e)
    }

    const next = this.session.hand_queue.pop()
    if (!next) return

    const token = this.session.issueToken(next.sender_id, CONFIG.token_ttl_sec, this.onTokenExpired)

    this.broadcast(this.makeEvent<HandAcceptedEvent>({
      sender_id: 'orchestrator',
      sender_role: 'orchestrator',
      event_type: 'hand_accepted',
      payload: {
        token_id: token.token_id,
        holder: next.sender_id,
        ttl_sec: CONFIG.token_ttl_sec,
      },
    }))
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  handleTopicOpen(event: TopicOpenEvent): void {
    try {
      this.session.open(event.payload.topic)
      this.broadcast(event)
    } catch (err) {
      console.warn('[orchestrator] topic_open ignored:', (err as Error).message)
    }
  }

  handleRaiseHand(event: RaiseHandEvent): void {
    const { sender_id, payload } = event

    if (this.session.state !== 'active' && this.session.state !== 'cooldown') {
      this.broadcast(this.makeEvent<HandRejectedEvent>({
        sender_id: 'orchestrator',
        sender_role: 'orchestrator',
        event_type: 'hand_rejected',
        payload: {
          reason: this.session.state === 'closing' ? 'session_closing' : 'no_active_session',
          original_raise_hand_id: event.event_id,
        },
      }))
      return
    }

    if (this.session.isRateLimited(sender_id)) {
      this.broadcast(this.makeEvent<HandRejectedEvent>({
        sender_id: 'orchestrator',
        sender_role: 'orchestrator',
        event_type: 'hand_rejected',
        payload: { reason: 'rate_limit', original_raise_hand_id: event.event_id },
      }))
      return
    }

    // Dedup: same sender + same reason_code → merge
    const existing = this.session.hand_queue.find(sender_id, payload.reason_code)
    if (existing) {
      this.session.hand_queue.remove(e => e.event_id === existing.event_id)
      this.session.hand_queue.push({
        ...existing,
        intent: payload.intent,
        priority: PRIORITY_WEIGHT[payload.priority] > PRIORITY_WEIGHT[existing.priority]
          ? payload.priority
          : existing.priority,
        score: this.computeScore(existing),
      })
      this.broadcast(event)
      return
    }

    // New entry
    const mention_bonus = payload.reply_to ? MENTION_BONUS_AGENT : 0
    const enqueued_at = Date.now()
    this.session.hand_queue.push({
      event_id: event.event_id,
      sender_id,
      intent: payload.intent,
      priority: payload.priority,
      reason_code: payload.reason_code,
      reply_to: payload.reply_to,
      enqueued_at,
      score: this.computeScore({ sender_id, priority: payload.priority, enqueued_at }, mention_bonus),
    })
    this.broadcast(event)
    this.dispatchNext()
  }

  handleSpeak(event: SpeakEvent): void {
    if (!this.session.validateToken(event.payload.token_id, event.sender_id)) {
      console.warn('[orchestrator] speak rejected: invalid token', event.payload.token_id, event.sender_id)
      return
    }
    this.session.recordSpeak(event.sender_id)
    this.broadcast(event)
  }

  handleYieldToken(event: YieldTokenEvent): void {
    const token = this.session.current_token
    if (!token || token.token_id !== event.payload.token_id) return
    if (token.holder !== event.sender_id) return

    this.session.releaseToken()
    this.broadcast(event)

    if (this.session.pending_user_message) {
      const pending = this.session.pending_user_message
      this.session.pending_user_message = null
      this.broadcast(pending)
    }

    this.dispatchNext()
  }

  handleUserMessage(event: UserMessageEvent): void {
    const mode = event.payload.interrupt_mode ?? 'soft'

    if (this.session.current_token) {
      if (mode === 'hard') {
        const revoked = this.session.releaseToken()!
        this.broadcast(this.makeEvent<InterruptGrantedEvent>({
          sender_id: 'orchestrator',
          sender_role: 'orchestrator',
          event_type: 'interrupt_granted',
          payload: { token_id: revoked.token_id, new_holder: event.sender_id, ttl_sec: 0 },
        }))
        this.broadcast(event)
      } else {
        this.session.pending_user_message = event
      }
    } else {
      this.broadcast(event)
    }
  }

  handleRetarget(event: RetargetEvent): void {
    this.broadcast(event)

    const entries = this.session.hand_queue.toArray()
    this.session.hand_queue.remove(() => true)
    for (const e of entries) {
      if (e.sender_id === event.payload.agent_id) {
        e.score = this.computeScore(e, MENTION_BONUS_USER)
      }
      this.session.hand_queue.push(e)
    }

    this.dispatchNext()
  }

  handleInterruptRequest(event: InterruptRequestEvent): void {
    const token = this.session.current_token
    if (!token || token.token_id !== event.payload.target_token_id) return

    this.session.releaseToken()
    this.session.issueToken(event.sender_id, CONFIG.token_ttl_sec, this.onTokenExpired)

    this.broadcast(event)
    this.broadcast(this.makeEvent<InterruptGrantedEvent>({
      sender_id: 'orchestrator',
      sender_role: 'orchestrator',
      event_type: 'interrupt_granted',
      payload: {
        token_id: event.payload.target_token_id,
        new_holder: event.sender_id,
        ttl_sec: CONFIG.token_ttl_sec,
      },
    }))
  }

  handleCloseRequest(event: CloseRequestEvent): void {
    this.session.startClosing()
    this.broadcast(event)
  }

  handleFinalSummary(event: FinalSummaryEvent): void {
    if (event.sender_role !== 'host_agent') return
    this.broadcast(event)
    this.session.close()
  }

  // ── Router ─────────────────────────────────────────────────────────────────

  route(event: PartyEvent): void {
    switch (event.event_type) {
      case 'topic_open': return this.handleTopicOpen(event)
      case 'raise_hand': return this.handleRaiseHand(event)
      case 'speak': return this.handleSpeak(event)
      case 'yield_token': return this.handleYieldToken(event)
      case 'user_message': return this.handleUserMessage(event)
      case 'retarget': return this.handleRetarget(event)
      case 'interrupt_request': return this.handleInterruptRequest(event)
      case 'close_request': return this.handleCloseRequest(event)
      case 'final_summary': return this.handleFinalSummary(event)
      default:
        console.warn('[orchestrator] unhandled event_type:', (event as PartyEvent).event_type)
    }
  }
}

// ─── Registry: session_id → Orchestrator ──────────────────────────────────────

const orchestrators = new Map<string, Orchestrator>()

export function getOrCreateOrchestrator(session: Session): Orchestrator {
  let orch = orchestrators.get(session.session_id)
  if (!orch) {
    orch = new Orchestrator(session)
    orchestrators.set(session.session_id, orch)
  }
  return orch
}

export function getOrchestrator(session_id: string): Orchestrator | undefined {
  return orchestrators.get(session_id)
}

export function removeOrchestrator(session_id: string): void {
  orchestrators.delete(session_id)
}

// ─── Legacy compat: default orchestrator + global functions ───────────────────

import { session } from './session'

const defaultOrch = getOrCreateOrchestrator(session)

/** @deprecated Use getOrCreateOrchestrator(session).setBroadcast() instead */
export function setBroadcast(fn: (event: PartyEvent) => void): void {
  defaultOrch.setBroadcast(fn)
}

/** @deprecated Use getOrCreateOrchestrator(session).dispatchNext() instead */
export function dispatchNext(): void {
  defaultOrch.dispatchNext()
}

/** @deprecated Use orchestrator.route(event) instead */
export function route(event: PartyEvent): void {
  defaultOrch.route(event)
}

// Legacy handler re-exports
export const handleTopicOpen = (e: TopicOpenEvent) => defaultOrch.handleTopicOpen(e)
export const handleRaiseHand = (e: RaiseHandEvent) => defaultOrch.handleRaiseHand(e)
export const handleSpeak = (e: SpeakEvent) => defaultOrch.handleSpeak(e)
export const handleYieldToken = (e: YieldTokenEvent) => defaultOrch.handleYieldToken(e)
export const handleUserMessage = (e: UserMessageEvent) => defaultOrch.handleUserMessage(e)
export const handleRetarget = (e: RetargetEvent) => defaultOrch.handleRetarget(e)
export const handleInterruptRequest = (e: InterruptRequestEvent) => defaultOrch.handleInterruptRequest(e)
export const handleCloseRequest = (e: CloseRequestEvent) => defaultOrch.handleCloseRequest(e)
export const handleFinalSummary = (e: FinalSummaryEvent) => defaultOrch.handleFinalSummary(e)
