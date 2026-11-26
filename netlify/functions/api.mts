import os from 'node:os';
import path from 'node:path';
import { createRiskApiServer, type RiskApiServerHandle } from '../../server/app.ts';

let cachedHandle: RiskApiServerHandle | null = null;

function getServerHandle(): RiskApiServerHandle {
  if (!cachedHandle) {
    const dbPath = process.env.DDPM_DB_PATH ?? path.join(os.tmpdir(), 'ddpm_risk.sqlite');
    try {
      cachedHandle = createRiskApiServer({
        dbPath,
        staticDir: null,
        demoMode: process.env.DDPM_STRICT_PROD !== 'true',
      });
    } catch {
      cachedHandle = createRiskApiServer({
        dbPath: ':memory:',
        staticDir: null,
        demoMode: process.env.DDPM_STRICT_PROD !== 'true',
      });
    }
  }
  return cachedHandle;
}

export default async function handler(req: Request): Promise<Response> {
  const handle = getServerHandle();
  const url = new URL(req.url);
  const pathWithQuery = `${url.pathname}${url.search}`;

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  if (!headers.host) {
    headers.host = url.host;
  }
  if (!headers['x-forwarded-proto'] && url.protocol === 'https:') {
    headers['x-forwarded-proto'] = 'https';
  }

  let body: string | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await req.text();
  }

  const remoteAddress =
    headers['x-nf-client-connection-ip'] ??
    headers['x-forwarded-for']?.split(',')[0]?.trim() ??
    '127.0.0.1';

  const result = await handle.invoke({
    method: req.method,
    url: pathWithQuery,
    headers,
    body: body && body.length > 0 ? body : undefined,
    remoteAddress,
  });

  const outHeaders = new Headers();
  for (const [key, val] of Object.entries(result.headers)) {
    if (key.toLowerCase() === 'content-length') continue;
    if (Array.isArray(val)) {
      for (const item of val) outHeaders.append(key, item);
    } else {
      outHeaders.set(key, val);
    }
  }

  return new Response(result.bodyText, {
    status: result.status,
    headers: outHeaders,
  });
}

export const config = {
  path: '/api/*',
};
