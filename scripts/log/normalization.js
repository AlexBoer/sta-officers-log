/**
 * Normalization Guards
 *
 * Module-level state for tracking normalization operations on logs and actors.
 * Used to prevent re-entrancy during item update hooks.
 */

// Module-level state for tracking normalization operations
const _staNormalizingLogIds = new Set();
const _staNormalizingActorIds = new Set();

/**
 * Check if a log is currently being normalized.
 */
export function isLogBeingNormalized(logId) {
  return _staNormalizingLogIds.has(String(logId ?? ""));
}

/**
 * Check if an actor is currently being normalized.
 */
export function isActorBeingNormalized(actorId) {
  return _staNormalizingActorIds.has(String(actorId ?? ""));
}

/**
 * Mark a log as being normalized (to prevent re-entrancy).
 */
export function markLogNormalizing(logId, normalizing = true) {
  const id = String(logId ?? "");
  if (!id) return;
  if (normalizing) {
    _staNormalizingLogIds.add(id);
  } else {
    _staNormalizingLogIds.delete(id);
  }
}

/**
 * Mark an actor as being normalized (to prevent re-entrancy).
 */
export function markActorNormalizing(actorId, normalizing = true) {
  const id = String(actorId ?? "");
  if (!id) return;
  if (normalizing) {
    _staNormalizingActorIds.add(id);
  } else {
    _staNormalizingActorIds.delete(id);
  }
}
