/**
 * Basic-auth middleware — protects all routes when BASIC_AUTH_USER + BASIC_AUTH_PASS are set.
 *
 * If either env var is empty, auth is disabled (dev convenience).
 * The /api/jobs/* routes are also protected so external callers
 * can't trigger jobs without credentials.
 */

import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;

  // If auth not configured, skip
  if (!user || !pass) {
    return NextResponse.next();
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader) {
    const [scheme, encoded] = authHeader.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = atob(encoded);
      const [u, p] = decoded.split(':');
      if (u === user && p === pass) {
        return NextResponse.next();
      }
    }
  }

  // Return 401 with WWW-Authenticate header to trigger the browser's basic-auth dialog
  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Market OS"',
    },
  });
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
