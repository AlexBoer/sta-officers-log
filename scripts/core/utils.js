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
