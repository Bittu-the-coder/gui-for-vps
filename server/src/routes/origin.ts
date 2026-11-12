/**
 * WebSocket Origin check. Browsers always send Origin; a page on another site cannot forge
 * it. Non-browser clients send none and are still protected by the session token.
 */
export function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  return origin === undefined || allowed.includes(origin);
}
