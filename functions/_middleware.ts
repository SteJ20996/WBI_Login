import { error } from './_lib/http';
import { ensureSchema } from './_lib/schema';
import type { Fn } from './_lib/types';

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const onRequest: Fn = async (ctx) => {
  const url = new URL(ctx.request.url);

  // One address only: www goes to the bare domain.
  if (url.hostname.startsWith('www.')) {
    url.hostname = url.hostname.slice(4);
    return Response.redirect(url.toString(), 308);
  }

  let response: Response;
  if (url.pathname.startsWith('/api/')) {
    const method = ctx.request.method;
    // Requests that change something must come from this site's own pages.
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = ctx.request.headers.get('Origin');
      if (!origin || origin !== url.origin) return withHeaders(error('origin', 403), url);
    }
    try {
      await ensureSchema(ctx.env);
      response = await ctx.next();
    } catch (err) {
      console.error('api error', err);
      response = error('unavailable', 503);
    }
  } else {
    response = await ctx.next();
  }
  return withHeaders(response, url);
};

function withHeaders(response: Response, url: URL): Response {
  const out = new Response(response.body, response);
  const h = out.headers;
  h.set('X-Robots-Tag', 'noindex, nofollow');
  h.set('Content-Security-Policy', CSP);
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (url.protocol === 'https:') h.set('Strict-Transport-Security', 'max-age=31536000');
  if (url.pathname.startsWith('/api/') || url.pathname === '/' || url.pathname.startsWith('/agent')) h.set('Cache-Control', 'no-store');
  return out;
}
