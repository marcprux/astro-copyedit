import { dev } from 'astro';
import { prepareSite } from './sites.mjs';
const name = process.argv[2];
if (!['demo', 'starlight'].includes(name)) throw new Error('Expected demo or starlight test site');
const root = await prepareSite(name);
const server = await dev({ root, server: { host: '127.0.0.1', port: name === 'demo' ? 4323 : 4324 }, vite: { server: { strictPort: true } } });
async function stop() { await server.stop(); process.exit(0); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
