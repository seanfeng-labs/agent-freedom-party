import TinyQueue from 'tinyqueue'
import type { HandEntry } from './types'

export class HandQueue {
  private q = new TinyQueue<HandEntry>([], (a, b) => b.score - a.score)

  push(entry: HandEntry): void {
    this.q.push(entry)
  }

  pop(): HandEntry | undefined {
    return this.q.pop()
  }

  peek(): HandEntry | undefined {
    return this.q.peek()
  }

  get size(): number {
    return this.q.length
  }

  /**
   * Remove all entries matching predicate (O(n) rebuild — acceptable for MVP queue sizes).
   */
  remove(predicate: (e: HandEntry) => boolean): HandEntry[] {
    const kept: HandEntry[] = []
    const removed: HandEntry[] = []

    while (this.q.length > 0) {
      const entry = this.q.pop()!
      if (predicate(entry)) removed.push(entry)
      else kept.push(entry)
    }

    for (const e of kept) this.q.push(e)
    return removed
  }

  /**
   * Find existing entry by sender + reason_code for dedup check (no mutation).
   */
  find(sender_id: string, reason_code: string): HandEntry | undefined {
    // TinyQueue doesn't expose iteration; drain + rebuild
    const all: HandEntry[] = []
    while (this.q.length > 0) all.push(this.q.pop()!)
    for (const e of all) this.q.push(e)
    return all.find(e => e.sender_id === sender_id && e.reason_code === reason_code)
  }

  toArray(): HandEntry[] {
    const all: HandEntry[] = []
    while (this.q.length > 0) all.push(this.q.pop()!)
    for (const e of all) this.q.push(e)
    return all
  }
}
