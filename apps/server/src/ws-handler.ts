import type { WebSocket } from '@fastify/websocket'
import type { FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { parsePartyEvent } from '@ai-party/protocol'
import type { PartyEvent } from '@ai-party/protocol'
import { getOrCreateOrchestrator, removeOrchestrator, type Orchestrator } from './orchestrator'
import { sessionManager } from './session'
import type { Session } from './session'

// ─── Per-session client registry ──────────────────────────────────────────────
// Outer key: session_id → inner key: client_id → WebSocket

const sessionClients = new Map<string, Map<string, WebSocket>>()

function getClients(session_id: string): Map<string, WebSocket> {
  let m = sessionClients.get(session_id)
  if (!m) {
    m = new Map()
    sessionClients.set(session_id, m)
  }
  return m
}

function broadcastToSession(session_id: string, event: PartyEvent): void {
  const payload = JSON.stringify(event)
  const clients = sessionClients.get(session_id)
  if (!clients) return
  for (const ws of clients.values()) {
    if (ws.readyState === ws.OPEN) ws.send(payload)
  }
}

/** Remove all clients and orchestrator for a session */
export function teardownSession(session_id: string): void {
  const clients = sessionClients.get(session_id)
  if (clients) {
    for (const ws of clients.values()) {
      try { ws.close(1001, 'session_destroyed') } catch { /* noop */ }
    }
    sessionClients.delete(session_id)
  }
  removeOrchestrator(session_id)
}

/** Get the number of connected clients for a session */
export function clientCount(session_id: string): number {
  return sessionClients.get(session_id)?.size ?? 0
}

// ─── Ensure orchestrator has broadcast wired ──────────────────────────────────

function ensureOrchestrator(sess: Session): Orchestrator {
  const orch = getOrCreateOrchestrator(sess)
  // Re-wire broadcast every time (idempotent, cheap)
  orch.setBroadcast((event) => broadcastToSession(sess.session_id, event))
  return orch
}

// ─── Snapshot helper ──────────────────────────────────────────────────────────

function sendSnapshot(socket: WebSocket, sess: Session): void {
  socket.send(JSON.stringify({
    type: 'session_snapshot',
    session_id: sess.session_id,
    state: sess.state,
    topic: sess.topic,
    current_token: sess.current_token
      ? { holder: sess.current_token.holder, token_id: sess.current_token.token_id }
      : null,
    queue_size: sess.hand_queue.size,
    event_log_length: sess.event_log.length,
  }))
}

// ─── Connection handler (parameterised by session_id) ─────────────────────────

export function createWsHandler(session_id: string) {
  return function wsConnectionHandler(socket: WebSocket, _req: FastifyRequest): void {
    const sess = sessionManager.getOrCreate(session_id)
    const orch = ensureOrchestrator(sess)

    const client_id = randomUUID()
    const clients = getClients(session_id)
    clients.set(client_id, socket)
    console.log(`[ws] connected: ${client_id} session=${session_id} (clients: ${clients.size})`)

    sendSnapshot(socket, sess)

    socket.on('message', (raw) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw.toString())
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'invalid JSON' }))
        return
      }

      // Stamp server-side fields
      if (parsed !== null && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>
        if (!obj['event_id']) obj['event_id'] = randomUUID()
        if (!obj['session_id']) obj['session_id'] = session_id
        obj['timestamp'] = Date.now()
      }

      let event: PartyEvent
      try {
        event = parsePartyEvent(parsed)
      } catch (err: unknown) {
        socket.send(JSON.stringify({
          type: 'error',
          message: 'schema validation failed',
          detail: err instanceof Error ? err.message : String(err),
        }))
        return
      }

      try {
        orch.route(event)
      } catch (err) {
        console.error('[ws] route error:', err)
        socket.send(JSON.stringify({ type: 'error', message: (err as Error).message }))
      }
    })

    socket.on('close', () => {
      clients.delete(client_id)
      console.log(`[ws] disconnected: ${client_id} session=${session_id} (clients: ${clients.size})`)
    })

    socket.on('error', (err) => {
      console.error(`[ws] error on ${client_id}:`, err)
      clients.delete(client_id)
    })
  }
}

// ─── Legacy compat: single-session handler ────────────────────────────────────

import { session } from './session'
import { setBroadcast, route } from './orchestrator'

const clients = new Map<string, WebSocket>()

function broadcast(event: PartyEvent): void {
  const payload = JSON.stringify(event)
  for (const ws of clients.values()) {
    if (ws.readyState === ws.OPEN) ws.send(payload)
  }
}

setBroadcast(broadcast)

/** @deprecated Use createWsHandler(sessionId) instead */
export function wsConnectionHandler(socket: WebSocket, _req: FastifyRequest): void {
  const client_id = randomUUID()
  clients.set(client_id, socket)
  console.log(`[ws] connected: ${client_id} (total: ${clients.size})`)

  sendSnapshot(socket, session)

  socket.on('message', (raw) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString())
    } catch {
      socket.send(JSON.stringify({ type: 'error', message: 'invalid JSON' }))
      return
    }

    if (parsed !== null && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>
      if (!obj['event_id']) obj['event_id'] = randomUUID()
      if (!obj['session_id']) obj['session_id'] = session.session_id
      obj['timestamp'] = Date.now()
    }

    let event: PartyEvent
    try {
      event = parsePartyEvent(parsed)
    } catch (err: unknown) {
      socket.send(JSON.stringify({
        type: 'error',
        message: 'schema validation failed',
        detail: err instanceof Error ? err.message : String(err),
      }))
      return
    }

    try {
      route(event)
    } catch (err) {
      console.error('[ws] route error:', err)
      socket.send(JSON.stringify({ type: 'error', message: (err as Error).message }))
    }
  })

  socket.on('close', () => {
    clients.delete(client_id)
    console.log(`[ws] disconnected: ${client_id} (total: ${clients.size})`)
  })

  socket.on('error', (err) => {
    console.error(`[ws] error on ${client_id}:`, err)
    clients.delete(client_id)
  })
}
