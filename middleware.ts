// Auth is handled client-side via supabase.auth.getSession() in each page.
// The dashboard redirects to /login if no session is found.
// No middleware needed for localStorage-based auth.

export function middleware() {}

export const config = { matcher: [] };
