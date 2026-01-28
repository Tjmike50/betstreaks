/**
 * Auth utilities
 * 
 * Currently returns false (offline mode).
 * Will be replaced with Supabase Auth state when authentication is implemented.
 */

// Placeholder - will be replaced with real Supabase Auth state
let _authState: { userId: string | null } = { userId: null };

/**
 * Check if user is logged in.
 * All watchlist gating depends on this function.
 * 
 * @returns true if authenticated, false otherwise
 */
export function isLoggedIn(): boolean {
  return _authState.userId !== null;
}

/**
 * Get the current user ID.
 * 
 * @returns User ID if logged in, null otherwise
 */
export function getUserId(): string | null {
  return _authState.userId;
}

/**
 * Set auth state (for internal use when implementing real auth)
 * @internal
 */
export function setAuthState(userId: string | null): void {
  _authState = { userId };
}
