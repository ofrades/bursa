/**
 * Global singleton store for in-flight AI analysis streams.
 *
 * Listeners are stored separately from stream entries so that a component
 * can subscribe BEFORE a stream starts (and stay subscribed across restarts).
 * This means:
 *   1. useEffect subscribes on mount — listener is registered even if idle
 *   2. start() calls init() — entry is created, existing listeners notified
 *   3. runStream() calls update/appendText — listeners notified every chunk
 *   4. Navigate away → component unmounts, listener removed via unsubscribe
 *   5. Navigate back → new component mounts, subscribes, reads current state
 */

export type StreamingState = {
  isLoading: boolean;
  isComplete: boolean;
  analysisSaved: boolean;
  text: string;
  error: string | null;
  warning: string | null;
};

export const STREAM_INITIAL_STATE: StreamingState = {
  isLoading: false,
  isComplete: false,
  analysisSaved: false,
  text: "",
  error: null,
  warning: null,
};

type StreamEntry = {
  state: StreamingState;
  abort: () => void;
};

// Active stream entries (null = no stream running for that symbol)
const entries = new Map<string, StreamEntry>();
// Listeners keyed by symbol — persist across entry create/destroy
const listeners = new Map<string, Set<() => void>>();

function getListeners(symbol: string): Set<() => void> {
  let set = listeners.get(symbol);
  if (!set) {
    set = new Set();
    listeners.set(symbol, set);
  }
  return set;
}

function notify(symbol: string) {
  getListeners(symbol).forEach((l) => l());
}

export const analysisStreamStore = {
  /** Returns the current streaming state for symbol, or null if none active. */
  get(symbol: string): StreamingState | null {
    return entries.get(symbol)?.state ?? null;
  },

  /** True when there is an active or just-completed stream for symbol. */
  isActive(symbol: string): boolean {
    const e = entries.get(symbol);
    return !!(e && (e.state.isLoading || e.state.text));
  },

  /**
   * Subscribe to state changes for symbol.
   * Works even before a stream has been started.
   * Returns an unsubscribe fn.
   */
  subscribe(symbol: string, listener: () => void): () => void {
    getListeners(symbol).add(listener);
    return () => {
      getListeners(symbol).delete(listener);
    };
  },

  /**
   * Create (or replace) the stream entry for symbol and notify subscribers.
   * Existing listeners are preserved because they live in a separate map.
   */
  init(symbol: string, abortFn: () => void): void {
    entries.get(symbol)?.abort();
    entries.set(symbol, {
      state: { ...STREAM_INITIAL_STATE, isLoading: true },
      abort: abortFn,
    });
    notify(symbol);
  },

  /** Merge a partial state patch and notify all subscribers. */
  update(symbol: string, patch: Partial<StreamingState>): void {
    const entry = entries.get(symbol);
    if (!entry) return;
    entry.state = { ...entry.state, ...patch };
    notify(symbol);
  },

  /** Append delta text (hot path — avoids extra spread). */
  appendText(symbol: string, delta: string): void {
    const entry = entries.get(symbol);
    if (!entry) return;
    entry.state = { ...entry.state, text: entry.state.text + delta };
    notify(symbol);
  },

  /** Explicitly abort and remove the entry (user pressed Stop). */
  abort(symbol: string): void {
    const entry = entries.get(symbol);
    if (entry) {
      entry.abort();
      entries.delete(symbol);
      notify(symbol);
    }
  },

  /** Remove the entry after the saved analysis has been loaded into the page. */
  clear(symbol: string): void {
    entries.delete(symbol);
    // Also clean up empty listener sets to avoid leaking memory
    if (getListeners(symbol).size === 0) {
      listeners.delete(symbol);
    }
  },
};
