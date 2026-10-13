import { timingSafeEqual } from 'node:crypto';
import { EditError } from './source.js';

function secureEqual(a, b) {
  return typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export function allowedRequest(req, token) {
  try {
    const protocol = req.socket.encrypted ? 'https:' : 'http:';
    const origin = new URL(`${protocol}//${req.headers.host}`);
    const remote = req.socket.remoteAddress;
    return ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) &&
      ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) &&
      req.headers.origin === origin.origin &&
      secureEqual(req.headers['x-copyedit-token'], token) &&
      req.headers['content-type']?.split(';')[0].trim() === 'application/json';
  } catch { return false; }
}
export function saveMiddleware({ endpoint, token, sources, afterSave = async () => {} }) {
  return async (req, res, next) => {
    if ((req.originalUrl ?? req.url)?.split('?')[0] !== endpoint) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    const reply = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(405, { error: 'badRequest' }); }
    if (!allowedRequest(req, token)) return reply(403, { error: 'forbidden' });
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65_536) throw new EditError('tooLarge', 413);
        chunks.push(chunk);
      }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new EditError('badRequest'); }
      if (!payload || typeof payload !== 'object') throw new EditError('badRequest');
      const { operation = 'save', mode = 'text', scope = 0 } = payload;
      const validId = id => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);
      if (!['save', 'source', 'selection'].includes(operation) || !['text', 'source'].includes(mode) || !Number.isInteger(scope) || scope < 0) throw new EditError('badRequest');
      if (operation === 'selection') {
        if (!Array.isArray(payload.ids) || !payload.ids.length || payload.ids.length > 256 || !payload.ids.every(validId)) throw new EditError('badRequest');
        return reply(200, await sources.selection(payload.ids, payload.selection));
      }
      if (!validId(payload.id) || (operation === 'save' ? typeof payload.text !== 'string' : payload.text !== undefined && typeof payload.text !== 'string')) throw new EditError('badRequest');
      if (operation === 'source') return reply(200, await sources.source(payload.id, payload.text, scope, payload.selection));
      const result = await sources.save(payload.id, payload.text, mode, scope);
      await afterSave(result);
      reply(200, { saved: true });
    } catch (error) {
      reply(error instanceof EditError ? error.status : 500, { error: error instanceof EditError ? error.code : 'errorUnknown' });
    }
  };
}
