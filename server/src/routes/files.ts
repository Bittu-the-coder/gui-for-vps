import { basename } from 'node:path/posix';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  EDITOR_MAX_BYTES,
  UPLOAD_MAX_BYTES,
  type ListResponse,
  type ReadResponse,
  type WriteResponse,
} from '@gfv/shared';
import type { AppContext } from '../context.js';
import { normalizePath } from '../services/sftp/paths.js';
import { SftpError } from '../services/sftp/sftp.js';

const STATUS = {
  not_connected: 409,
  not_found: 404,
  permission_denied: 403,
  exists: 409,
  is_directory: 400,
  too_large: 413,
  invalid_path: 400,
  failed: 500,
} as const;

/** Browse, read, save, upload and download files over SFTP. Paths are always absolute (or "~" for list). */
export function fileRoutes(app: FastifyInstance, { sftp, vault }: AppContext): void {
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.includes('/fs/') && !vault.unlocked)
      return reply.code(423).send({ error: 'locked' });
  });

  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof SftpError) {
      return reply.code(STATUS[err.code]).send({ error: err.code, message: err.message });
    }
    throw err;
  };
  const badPath = (reply: FastifyReply) => reply.code(400).send({ error: 'invalid_path' });

  type Q = { Params: { id: string }; Querystring: { path?: string } };

  app.get<Q>(
    '/api/servers/:id/fs/list',
    async (req, reply): Promise<ListResponse | FastifyReply> => {
      try {
        const home = await sftp.home(req.params.id);
        const requested =
          req.query.path === '~' || !req.query.path ? home : normalizePath(req.query.path);
        if (!requested) return badPath(reply);
        const entries = await sftp.list(req.params.id, requested);
        return { path: requested, home, entries };
      } catch (e) {
        return fail(reply, e);
      }
    },
  );

  /** Editor read: JSON text, or the reason it can't be edited. */
  app.get<Q>(
    '/api/servers/:id/fs/read',
    async (req, reply): Promise<ReadResponse | FastifyReply> => {
      const path = normalizePath(req.query.path);
      if (!path) return badPath(reply);
      try {
        const r = await sftp.readText(req.params.id, path);
        return { path, ...r };
      } catch (e) {
        return fail(reply, e);
      }
    },
  );

  app.get<Q>('/api/servers/:id/fs/download', async (req, reply) => {
    const path = normalizePath(req.query.path);
    if (!path) return badPath(reply);
    try {
      const { stream, size } = await sftp.createReadStream(req.params.id, path);
      const name = basename(path).replace(/[^\w.\- ]/g, '_') || 'download';
      return reply
        .header('content-type', 'application/octet-stream')
        .header('content-length', size)
        .header(
          'content-disposition',
          `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(basename(path))}`,
        )
        .send(stream);
    } catch (e) {
      return fail(reply, e);
    }
  });

  /**
   * Editor save and upload: the raw bytes are the body (content-type application/octet-stream).
   * `?create=1` refuses to overwrite an existing file (uploads).
   */
  app.put<Q & { Querystring: { path?: string; create?: string } }>(
    '/api/servers/:id/fs/file',
    { bodyLimit: UPLOAD_MAX_BYTES },
    async (req, reply): Promise<WriteResponse | FastifyReply> => {
      const path = normalizePath(req.query.path);
      if (!path || path === '/') return badPath(reply);
      const body = req.body as Readable | undefined;
      if (!body || typeof body.pipe !== 'function') {
        return reply.code(415).send({ error: 'expected_octet_stream' });
      }
      const create = req.query.create === '1';
      try {
        // Editor saves are capped like editor reads; uploads get the bigger cap.
        return await sftp.write(req.params.id, path, body, {
          createOnly: create,
          maxBytes: create ? UPLOAD_MAX_BYTES : EDITOR_MAX_BYTES,
        });
      } catch (e) {
        body.resume(); // drain what the browser is still sending so the response can go out
        return fail(reply, e);
      }
    },
  );
}
