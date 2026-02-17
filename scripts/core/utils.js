/**
 * Check if a value is a plain object (not null, not an array).
 * Uses Foundry's getType for reliable type checking.
 * @param {*} value - The value to check
 * @returns {boolean} True if value is a plain object
 */
export function isPlainObject(value) {
  return foundry.utils.getType(value) === "Object";
}

/**
 * Safely get a value as a plain object, or return an empty object.
 * Useful for spreading flag data that may be null/undefined.
 * @param {*} value - The value to check
 * @returns {Object} The value if it's a plain object, otherwise {}
 */
export function asObject(value) {
  return isPlainObject(value) ? value : {};
}

/**
 * HTML-escape a string using Foundry's built-in utility.
 * @param {*} s – value to escape (coerced to string)
 * @returns {string}
 */
export function escapeHTML(s) {
  return foundry.utils.escapeHTML(String(s ?? ""));
}

/**
 * Returns true if this actor reference is from an unlinked token.
 * @param {Actor} actor
 * @returns {boolean}
 */
export function isUnlinkedTokenActor(actor) {
  try {
    if (!actor) return false;
    if (actor.isToken === true) {
      const tokenDoc = actor.token ?? null;
      if (tokenDoc && tokenDoc.actorLink === false) {
        return true;
      }
    }
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * Find the (non-GM) user whose assigned character matches this actor.
 * @param {Actor} actor
 * @returns {string|null} userId or null
 */
export function getUserIdForCharacterActor(actor) {
  if (!actor) return null;
  const assignedNonGM = game.users.find(
    (u) => !u.isGM && u.character && u.character.id === actor.id,
  );
  if (assignedNonGM) return assignedNonGM.id;
  const assignedAny = game.users.find(
    (u) => u.character && u.character.id === actor.id,
  );
  return assignedAny?.id ?? null;
}

/**
 * Returns whether the current user has Owner-level permission on an actor.
 * @param {Actor} actor
 * @returns {boolean}
 */
export function canCurrentUserChangeActor(actor) {
  try {
    if (!actor) return false;
    if (typeof actor.isOwner === "boolean") return actor.isOwner;
    return !!actor.testUserPermission?.(
      game.user,
      CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
    );
  } catch (_) {
    return false;
  }
}
