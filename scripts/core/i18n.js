export function t(key) {
  return game.i18n?.localize?.(key) ?? key;
}

export function tf(key, data) {
  return game.i18n?.format?.(key, data) ?? key;
}
