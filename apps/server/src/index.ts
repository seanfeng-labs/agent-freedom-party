import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyWebsocket from '@fastify/websocket'
import { createWsHandler, wsConnectionHandler, teardownSession, clientCount } from './ws-handler'
import { sessionManager, session } from './session'
import { ADMIN_HTML } from './admin-html'

const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '0.0.0.0'

async function buildServer() {
  const app = Fastify({ logger: true })
  await app.register(fastifyCors, { origin: true })
  await app.register(fastifyWebsocket)

  // ─── WebSocket (multi-session) ─────────────

  app.register(async (f) => {
    // New: per-session WS endpoint
    f.get('/party/:sessionId', { websocket: true }, (socket, req) => {
      const { sessionId } = req.params as { sessionId: string }
      createWsHandler(sessionId)(socket, req)
    })

    // Legacy: default session
    f.get('/party', { websocket: true }, wsConnectionHandler)
  })

  // ─── Session CRUD ──────────────────────────

  app.post('/sessions', async (_req, reply) => {
    const sess = sessionManager.create()
    reply.code(201)
    return {
      session_id: sess.session_id,
      state: sess.state,
      created_at: sess.created_at,
    }
  })

  app.get('/sessions', async () => {
    return sessionManager.list().map(s => ({
      session_id: s.session_id,
      state: s.state,
      topic: s.topic,
      created_at: s.created_at,
      clients: clientCount(s.session_id),
    }))
  })

  app.get('/sessions/:sessionId', async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string }
    const sess = sessionManager.get(sessionId)
    if (!sess) { reply.code(404); return { error: 'session_not_found' } }
    return {
      session_id: sess.session_id,
      state: sess.state,
      topic: sess.topic,
      created_at: sess.created_at,
      clients: clientCount(sess.session_id),
      current_token: sess.current_token
        ? { holder: sess.current_token.holder, token_id: sess.current_token.token_id, ttl_sec: sess.current_token.ttl_sec }
        : null,
      queue: sess.hand_queue.toArray().map(e => ({
        sender_id: e.sender_id,
        intent: e.intent,
        priority: e.priority,
        reason_code: e.reason_code,
        score: e.score,
      })),
      event_log_length: sess.event_log.length,
    }
  })

  app.delete('/sessions/:sessionId', async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string }
    const existed = sessionManager.destroy(sessionId)
    if (!existed) { reply.code(404); return { error: 'session_not_found' } }
    teardownSession(sessionId)
    return { ok: true }
  })

  // ─── HTTP ──────────────────────────────────

  app.get('/health', async () => ({ ok: true }))

  // ─── Admin panel ───────────────────────────

  app.get('/admin', async (_req, reply) => {
    reply.type('text/html').send(ADMIN_HTML)
  })

  // Admin API: full session event log
  app.get('/admin/sessions/:sessionId/events', async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string }
    const sess = sessionManager.get(sessionId)
    if (!sess) { reply.code(404); return { error: 'session_not_found' } }
    return sess.event_log.map(e => ({
      event_id: e.event_id,
      event_type: e.event_type,
      sender_id: e.sender_id,
      sender_role: e.sender_role,
      timestamp: e.timestamp,
      payload: e.payload,
    }))
  })

  // Legacy: default session debug
  app.get('/debug/session', async () => ({
    state: session.state,
    topic: session.topic,
    current_token: session.current_token
      ? {
        holder: session.current_token.holder,
        token_id: session.current_token.token_id,
        ttl_sec: session.current_token.ttl_sec,
      }
      : null,
    queue: session.hand_queue.toArray().map(e => ({
      sender_id: e.sender_id,
      intent: e.intent,
      priority: e.priority,
      reason_code: e.reason_code,
      score: e.score,
    })),
    event_log_length: session.event_log.length,
  }))

  return app
}

async function start() {
  try {
    const app = await buildServer()
    await app.listen({ port: PORT, host: HOST })
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

start()
