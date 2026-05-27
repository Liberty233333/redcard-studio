// Cloudflare Pages "Advanced Mode" worker.
// Lives at the build-output root (copied from public/ by Vite) so it ALSO works
// with dashboard "Direct Upload" of the dist/ zip.
//
// It mirrors the Vite dev image-proxy middleware: the browser calls the
// same-origin path `/__redcard_image_proxy?target=<https-url>` (POST), and this
// worker forwards the request server-side — bypassing browser CORS for both the
// text and image provider calls. Everything else is served as a static asset.
//
// Your API key is sent per-request from the browser and forwarded to your relay;
// it is never stored here.

const PROXY_PATH = '/__redcard_image_proxy';

const STRIP_REQUEST_HEADERS = new Set([
  'host', 'origin', 'referer', 'connection', 'content-length', 'cookie',
  'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor',
  'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-real-ip',
]);

const STRIP_RESPONSE_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === PROXY_PATH) {
      return handleProxy(request, url);
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleProxy(request, url) {
  const target = url.searchParams.get('target') || '';
  if (!/^https:\/\//i.test(target)) {
    return new Response('Proxy target must be an https URL.', { status: 400 });
  }

  const headers = new Headers();
  for (const [key, value] of request.headers) {
    if (STRIP_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    headers.set(key, value);
  }

  const method = request.method;
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();

  let upstream;
  try {
    upstream = await fetch(target, { method, headers, body });
  } catch (err) {
    return new Response('RedCard proxy failed: ' + ((err && err.message) || err), { status: 502 });
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const name of STRIP_RESPONSE_HEADERS) responseHeaders.delete(name);
  const buffer = await upstream.arrayBuffer();
  return new Response(buffer, { status: upstream.status, headers: responseHeaders });
}
