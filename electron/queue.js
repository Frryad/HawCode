'use strict';

/**
 * A latest-wins hold queue used while sync is paused.
 *
 * Operations are keyed by path, so editing the same file fifty times while
 * paused replays as one transfer on resume rather than fifty. Insertion order
 * is preserved for paths that are touched only once, which keeps create-then-
 * edit sequences in a sensible order.
 *
 * A later op on a path supersedes an earlier one, with one exception: a delete
 * followed by a re-create must not collapse into just the create for a *remote*
 * peer that never saw the delete — so a `create` landing on top of a `delete`
 * is stored as `change`, which is idempotent either way.
 */
class HoldQueue {
  constructor() {
    this.ops = new Map();
  }

  get size() {
    return this.ops.size;
  }

  /**
   * @param {string} key   path the op applies to
   * @param {object} op    { type: 'change' | 'delete' | 'mkdir' | 'rename', ... }
   */
  push(key, op) {
    const existing = this.ops.get(key);
    if (existing && existing.type === 'delete' && op.type === 'create') {
      this.ops.set(key, { ...op, type: 'change' });
      return;
    }
    // Re-setting an existing key keeps its original position in the Map, which
    // is what we want: the queue drains roughly in the order paths were first
    // touched.
    this.ops.set(key, op);
  }

  /** Remove and return every queued op, oldest key first. */
  drain() {
    const out = Array.from(this.ops.values());
    this.ops.clear();
    return out;
  }

  peek() {
    return Array.from(this.ops.values());
  }

  clear() {
    this.ops.clear();
  }
}

module.exports = { HoldQueue };
