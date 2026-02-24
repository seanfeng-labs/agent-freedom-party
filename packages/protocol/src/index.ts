import { z } from 'zod'

// ─── Primitives ───────────────────────────────────────────────────────────────

export const SenderRoleSchema = z.enum(['user', 'host_agent', 'role_agent', 'orchestrator'])
export const PrioritySchema = z.enum(['high', 'medium', 'low'])
export const ReasonCodeSchema = z.enum(['answer', 'challenge', 'risk', 'evidence', 'new_branch'])
export const SessionStateSchema = z.enum(['idle', 'active', 'cooldown', 'closing', 'closed'])
export const InterruptModeSchema = z.enum(['soft', 'hard'])

export const EventTypeSchema = z.enum([
  'topic_open',
  'raise_hand',
  'hand_accepted',
  'hand_rejected',
  'speak',
  'yield_token',
  'interrupt_request',
  'interrupt_granted',
  'user_message',
  'retarget',
  'close_request',
  'final_summary',
])

export type SenderRole = z.infer<typeof SenderRoleSchema>
export type Priority = z.infer<typeof PrioritySchema>
export type ReasonCode = z.infer<typeof ReasonCodeSchema>
export type SessionState = z.infer<typeof SessionStateSchema>
export type InterruptMode = z.infer<typeof InterruptModeSchema>
export type EventType = z.infer<typeof EventTypeSchema>

// ─── Base ─────────────────────────────────────────────────────────────────────

export const BaseEventSchema = z.object({
  event_id: z.string(),
  session_id: z.string(),
  timestamp: z.number(),
  sender_id: z.string(),
  sender_role: SenderRoleSchema,
  event_type: EventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
})

// ─── Payload schemas ──────────────────────────────────────────────────────────

export const TopicOpenPayloadSchema = z.object({
  topic: z.string().min(1),
})

export const RaiseHandPayloadSchema = z.object({
  intent: z.string().min(1),
  priority: PrioritySchema,
  reason_code: ReasonCodeSchema,
  reply_to: z.string().optional(),
})

export const HandAcceptedPayloadSchema = z.object({
  token_id: z.string(),
  holder: z.string(),
  ttl_sec: z.number().positive(),
})

export const HandRejectedPayloadSchema = z.object({
  reason: z.enum(['duplicate', 'off_topic', 'rate_limit', 'session_closing', 'no_active_session']),
  original_raise_hand_id: z.string(),
})

export const SpeakPayloadSchema = z.object({
  token_id: z.string(),
  text: z.string().min(1),
})

export const YieldTokenPayloadSchema = z.object({
  token_id: z.string(),
})

export const InterruptRequestPayloadSchema = z.object({
  reason: z.string(),
  target_token_id: z.string(),
})

export const InterruptGrantedPayloadSchema = z.object({
  token_id: z.string(),
  new_holder: z.string(),
  ttl_sec: z.number(),
})

export const UserMessagePayloadSchema = z.object({
  text: z.string().min(1),
  interrupt_mode: InterruptModeSchema.optional(),
})

export const RetargetPayloadSchema = z.object({
  agent_id: z.string(),
})

export const CloseRequestPayloadSchema = z.object({
  need: z.string().optional(),
})

export const FinalSummaryPayloadSchema = z.object({
  conclusion: z.string(),
  actions: z.array(z.string()),
  divergences: z.array(z.string()).optional(),
})

// ─── Typed event schemas ──────────────────────────────────────────────────────

export const TopicOpenEventSchema = BaseEventSchema.extend({
  event_type: z.literal('topic_open'),
  payload: TopicOpenPayloadSchema,
})

export const RaiseHandEventSchema = BaseEventSchema.extend({
  event_type: z.literal('raise_hand'),
  sender_role: z.literal('role_agent'),
  payload: RaiseHandPayloadSchema,
})

export const HandAcceptedEventSchema = BaseEventSchema.extend({
  event_type: z.literal('hand_accepted'),
  sender_role: z.literal('orchestrator'),
  payload: HandAcceptedPayloadSchema,
})

export const HandRejectedEventSchema = BaseEventSchema.extend({
  event_type: z.literal('hand_rejected'),
  sender_role: z.literal('orchestrator'),
  payload: HandRejectedPayloadSchema,
})

export const SpeakEventSchema = BaseEventSchema.extend({
  event_type: z.literal('speak'),
  payload: SpeakPayloadSchema,
})

export const YieldTokenEventSchema = BaseEventSchema.extend({
  event_type: z.literal('yield_token'),
  payload: YieldTokenPayloadSchema,
})

export const InterruptRequestEventSchema = BaseEventSchema.extend({
  event_type: z.literal('interrupt_request'),
  payload: InterruptRequestPayloadSchema,
})

export const InterruptGrantedEventSchema = BaseEventSchema.extend({
  event_type: z.literal('interrupt_granted'),
  sender_role: z.literal('orchestrator'),
  payload: InterruptGrantedPayloadSchema,
})

export const UserMessageEventSchema = BaseEventSchema.extend({
  event_type: z.literal('user_message'),
  sender_role: z.literal('user'),
  payload: UserMessagePayloadSchema,
})

export const RetargetEventSchema = BaseEventSchema.extend({
  event_type: z.literal('retarget'),
  sender_role: z.literal('user'),
  payload: RetargetPayloadSchema,
})

export const CloseRequestEventSchema = BaseEventSchema.extend({
  event_type: z.literal('close_request'),
  payload: CloseRequestPayloadSchema,
})

export const FinalSummaryEventSchema = BaseEventSchema.extend({
  event_type: z.literal('final_summary'),
  sender_role: z.literal('host_agent'),
  payload: FinalSummaryPayloadSchema,
})

// ─── Discriminated union ──────────────────────────────────────────────────────

export const PartyEventSchema = z.discriminatedUnion('event_type', [
  TopicOpenEventSchema,
  RaiseHandEventSchema,
  HandAcceptedEventSchema,
  HandRejectedEventSchema,
  SpeakEventSchema,
  YieldTokenEventSchema,
  InterruptRequestEventSchema,
  InterruptGrantedEventSchema,
  UserMessageEventSchema,
  RetargetEventSchema,
  CloseRequestEventSchema,
  FinalSummaryEventSchema,
])

// ─── Inferred types ───────────────────────────────────────────────────────────

export type TopicOpenEvent = z.infer<typeof TopicOpenEventSchema>
export type RaiseHandEvent = z.infer<typeof RaiseHandEventSchema>
export type HandAcceptedEvent = z.infer<typeof HandAcceptedEventSchema>
export type HandRejectedEvent = z.infer<typeof HandRejectedEventSchema>
export type SpeakEvent = z.infer<typeof SpeakEventSchema>
export type YieldTokenEvent = z.infer<typeof YieldTokenEventSchema>
export type InterruptRequestEvent = z.infer<typeof InterruptRequestEventSchema>
export type InterruptGrantedEvent = z.infer<typeof InterruptGrantedEventSchema>
export type UserMessageEvent = z.infer<typeof UserMessageEventSchema>
export type RetargetEvent = z.infer<typeof RetargetEventSchema>
export type CloseRequestEvent = z.infer<typeof CloseRequestEventSchema>
export type FinalSummaryEvent = z.infer<typeof FinalSummaryEventSchema>

export type PartyEvent = z.infer<typeof PartyEventSchema>

// ─── Guards ───────────────────────────────────────────────────────────────────

export function isPartyEvent(input: unknown): input is PartyEvent {
  return PartyEventSchema.safeParse(input).success
}

export function parsePartyEvent(input: unknown): PartyEvent {
  return PartyEventSchema.parse(input)
}
