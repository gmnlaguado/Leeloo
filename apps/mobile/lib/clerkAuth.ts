/**
 * Clerk auth bridge for non-hook contexts (e.g. lib/api.ts axios interceptors).
 *
 * The mobile app sets the Clerk token getter inside the React tree (where the
 * useAuth() hook is available). This module exposes the latest getter
 * imperatively so axios/fetch code can ask for a fresh JWT.
 */

let _getToken: (() => Promise<string | null | undefined>) | null = null;
let _userId: string | null = null;
let _signOut: (() => Promise<unknown>) | null = null;

export function setClerkTokenGetter(fn: (() => Promise<string | null | undefined>) | null) {
  _getToken = fn;
}

export function setClerkUserId(userId: string | null) {
  _userId = userId;
}

export function setClerkSignOut(fn: (() => Promise<unknown>) | null) {
  _signOut = fn;
}

export async function getClerkToken(): Promise<string | undefined> {
  if (!_getToken) return undefined;
  try {
    const token = await _getToken();
    return typeof token === 'string' && token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

export function getClerkUserId(): string | undefined {
  return _userId || undefined;
}

/**
 * Revokes the current Clerk session (clearing the cached SecureStore JWT).
 * No-ops if the bridge hasn't been wired up yet (e.g. ClerkProvider not mounted).
 */
export async function clerkSignOut(): Promise<void> {
  if (!_signOut) return;
  await _signOut();
}
