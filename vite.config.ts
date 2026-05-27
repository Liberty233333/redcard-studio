import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import type { Connect } from 'vite';
import {defineConfig, type Plugin} from 'vite';

const IMAGE_PROXY_PATH = '/__redcard_image_proxy';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), redcardImageProxy()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});

function redcardImageProxy(): Plugin {
  return {
    name: 'redcard-image-proxy',
    configureServer(server) {
      server.middlewares.use(IMAGE_PROXY_PATH, imageProxyMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(IMAGE_PROXY_PATH, imageProxyMiddleware);
    },
  };
}

const imageProxyMiddleware: Connect.NextHandleFunction = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('Method not allowed');
      return;
    }
    const requestUrl = new URL(req.url || '', 'http://localhost');
    const target = requestUrl.searchParams.get('target') || '';
    if (!/^https:\/\//i.test(target)) {
      res.statusCode = 400;
      res.end('Image proxy target must be an https URL.');
      return;
    }

    const body = await readRequestBody(req);
    const headers = forwardHeaders(req.headers);
    const upstream = await fetch(target, {
      method: 'POST',
      headers,
      body,
    });
    res.statusCode = upstream.status;
    upstream.headers.forEach((value, key) => {
      if (['content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) return;
      res.setHeader(key, value);
    });
    const responseBody = Buffer.from(await upstream.arrayBuffer());
    res.end(responseBody);
  } catch (err: any) {
    res.statusCode = 502;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(`RedCard image proxy failed: ${err?.message || err}`);
  }
};

function forwardHeaders(headers: Connect.IncomingHttpHeaders): Headers {
  const next = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (['host', 'origin', 'referer', 'connection', 'content-length'].includes(lower)) continue;
    next.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  return next;
}

function readRequestBody(req: Connect.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
