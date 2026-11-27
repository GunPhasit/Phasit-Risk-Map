import os from 'node:os';
import path from 'node:path';
import { createRiskApiServer, type RiskApiServerHandle } from '../../server/app.ts';
import {
  BlobDatabaseCoordinator,
  BlobSyncConflictError,
  createNetlifyBlobStore,
} from '../../server/blobStore.ts';
import { SECURITY_HEADERS } from '../../server/security.ts';

const DB_PATH = process.env.DDPM_DB_PATH ?? path.join(os.tmpdir(), 'ddpm_risk.sqlite');

let cachedHandle: RiskApiServerHandle | null = null;
let coordinator: BlobDatabaseCoordinator | null = null;
let initialized = false;
let initPromise: Promise<void> | null = null;

async function ensureInitialized(): Promise<void> {
  if (initialized && cachedHandle) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const demoMode = process.env.DDPM_STRICT_PROD !== 'true';
    const blobStore = createNetlifyBlobStore();

    if (blobStore) {
      try {
        const coord = new BlobDatabaseCoordinator(blobStore, DB_PATH);
        const masterKey = await coord.resolvePersistentMasterKey();
        const hadRemote = await coord.hydrateFromRemote();

        const handle = createRiskApiServer({
          dbPath: DB_PATH,
          staticDir: null,
          demoMode,
          masterKey,
          journalMode: 'DELETE',
          storageMode: 'netlify-blobs-sqlite',
        });

        if (!hadRemote) {
          handle.closeDb();
          try {
            await coord.uploadLocalSnapshot();
          } catch (err) {
            if (!(err instanceof BlobSyncConflictError)) {
              throw err;
            }
          }
          handle.reloadDb();
        }

        coordinator = coord;
        cachedHandle = handle;
        initialized = true;
        return;
      } catch (err) {
        console.warn('[DDPM Netlify Function] Blob persistence init failed, falling back to /tmp:', err);
      }
    }

    // Fallback: Ephemeral SQLite ใน /tmp (หรือ :memory: หากเขียน /tmp ไม่ได้)
    try {
      cachedHandle = createRiskApiServer({
        dbPath: DB_PATH,
        staticDir: null,
        demoMode,
        journalMode: 'DELETE',
        storageMode: 'ephemeral-sqlite',
      });
    } catch (err) {
      console.warn('[DDPM Netlify Function] /tmp SQLite failed, falling back to :memory::', err);
      cachedHandle = createRiskApiServer({
        dbPath: ':memory:',
        staticDir: null,
        demoMode,
        storageMode: 'ephemeral-sqlite',
      });
    }
    coordinator = null;
    initialized = true;
  })();

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

export default async function handler(req: Request): Promise<Response> {
  await ensureInitialized();
  const handle = cachedHandle!;
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

  const executeRequest = async (): Promise<Response> => {
    const isAuthOrMutating =
      req.method !== 'GET' ||
      url.pathname.startsWith('/api/auth/') ||
      url.pathname.startsWith('/api/officer/') ||
      url.pathname.startsWith('/api/change-requests') ||
      url.pathname.startsWith('/api/audit-logs') ||
      url.pathname.startsWith('/api/admin/');

    if (coordinator) {
      try {
        const remoteChanged = await coordinator.syncIfRemoteChanged(isAuthOrMutating);
        if (remoteChanged) {
          handle.reloadDb();
        }
      } catch (err) {
        console.warn('[DDPM Netlify Function] Warm ETag check skipped:', err);
      }
    }

    const mutationsBefore = handle.db.mutationCount;
    const result = await handle.invoke({
      method: req.method,
      url: pathWithQuery,
      headers,
      body: body && body.length > 0 ? body : undefined,
      remoteAddress,
    });

    if (coordinator && handle.db.mutationCount > mutationsBefore) {
      handle.closeDb();
      try {
        await coordinator.uploadLocalSnapshot();
      } catch (err) {
        handle.reloadDb();
        if (err instanceof BlobSyncConflictError) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 409,
            headers: {
              ...SECURITY_HEADERS,
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          });
        }
        console.error('[DDPM Netlify Function] Blob snapshot upload error:', err);
      }
      handle.reloadDb();
    }

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
  };

  if (coordinator) {
    return coordinator.withLock(executeRequest);
  }
  return executeRequest();
}

export const config = {
  path: '/api/*',
};
