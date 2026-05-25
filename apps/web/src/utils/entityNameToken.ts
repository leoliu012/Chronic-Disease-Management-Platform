/**
 * Entity-name token system (entity-name-chip-v1).
 *
 * Replaces the legacy `「name」` corner-bracket pattern used to call out
 * proper-name-like terms — medication names (`二甲双胍片`), vital
 * indicator names (`血糖`), plan titles, field names — in toast / message
 * / banner text. We carry the highlight intent through plain strings using
 * a Unicode marker pair, and the rendering layer (OperationToastHost,
 * inline JSX via `<EntityName>`) converts the markers into styled
 * `.entity-name-chip` pill spans.
 *
 *   nameToken('二甲双胍片')        // → '⟦二甲双胍片⟧'
 *   stripNameTokens('已删除⟦血糖⟧') // → '已删除血糖'
 *
 * `window.confirm()` and other plain-text consumers should call
 * `stripNameTokens()` (or simply build their text without the marker)
 * because native dialogs can't render HTML chips. Everything that flows
 * into React text — `setMessage`, toast `detail`, audit-log descriptions
 * surfaced via `OperationToastHost` — should use the markers so the chip
 * styling kicks in.
 */

export const NAME_TOKEN_OPEN = '⟦';
export const NAME_TOKEN_CLOSE = '⟧';

/** Pattern matching `⟦name⟧`. Reuse via `.lastIndex = 0` before each use. */
export const NAME_TOKEN_REGEX = /⟦([^⟦⟧]+)⟧/g;

/**
 * Wrap a proper-name in the chip marker. Returns an empty string when the
 * name is missing or whitespace-only, so callers can safely concatenate
 * without producing an empty `⟦⟧` pair.
 */
export function nameToken(name: string | null | undefined): string {
  if (name === null || name === undefined) return '';
  const trimmed = String(name).trim();
  if (!trimmed) return '';
  // Strip any nested markers so the renderer's regex stays well-formed.
  const safe = trimmed.replace(/[⟦⟧]/g, '');
  if (!safe) return '';
  return `${NAME_TOKEN_OPEN}${safe}${NAME_TOKEN_CLOSE}`;
}

/**
 * Strip chip markers from a string so it reads naturally in plain-text
 * contexts (window.confirm, plain audit logs, `title="..."` attributes).
 */
export function stripNameTokens(text: string | null | undefined): string {
  if (!text) return '';
  return String(text).replace(/⟦([^⟦⟧]*)⟧/g, '$1');
}

/**
 * Detect whether a string carries any chip markers without parsing.
 */
export function hasNameTokens(text: string | null | undefined): boolean {
  if (!text) return false;
  return String(text).indexOf(NAME_TOKEN_OPEN) >= 0;
}
