import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRiskApiServer } from './app.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? '4173');
const dbPath = process.env.DDPM_DB_PATH ?? path.resolve(PROJECT_ROOT, 'data/ddpm_risk.sqlite');
const staticDir =
  process.env.SERVE_STATIC === 'false' ? null : path.resolve(PROJECT_ROOT, 'dist');
const demoMode = process.env.NODE_ENV !== 'production';

const handle = createRiskApiServer({ dbPath, staticDir, demoMode });

handle.server.listen(port, host, () => {
  console.log(
    `[DDPM Risk Server] Running at http://${host}:${port} (SQLite: ${dbPath}, Static: ${staticDir ?? 'disabled'})`,
  );
});

const shutdown = () => {
  handle.close().finally(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
