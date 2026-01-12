/** @type {Map<string, Function> | null} */
export let pendingResponses = null;

export function setPendingResponses(map) {
  pendingResponses = map;
}
