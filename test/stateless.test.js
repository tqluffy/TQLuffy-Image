const assert = require('assert');
const { createMockKV, makeContext } = require('./helpers');

describe('stateless uploads', function () {
  it('uploads and serves without KV writes, rejects forged links, and observes whitelist mode', async function () {
    const { onRequestPost } = await import('../functions/upload.js');
    const { onRequest } = await import('../functions/file-stateless/[id].js');
    const kv = createMockKV();
    const objects = new Map();
    const env = {
      disable_telemetry: 'true', STORAGE_PROVIDER: 'r2', img_url: kv,
      STATELESS_LINK_SECRET: 'a test secret with sufficient entropy',
      img_r2: {
        async put(key, data) { objects.set(key, data); },
        async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; },
      },
    };
    const form = new FormData();
    form.append('file', new File(['hello'], 'test.png', { type: 'image/png' }));
    form.append('no_kv', 'true');
    const upload = await onRequestPost(makeContext({ env, request: new Request('https://example.com/upload', { method: 'POST', body: form }) }));
    assert.strictEqual(upload.status, 200);
    const [result] = await upload.json();
    assert.strictEqual(result.metadata.fileName, 'test.png');
    assert.strictEqual(result.metadata.fileSize, 5);
    assert.strictEqual(kv.operations.put.length, 0);
    const token = result.src.split('/').pop();
    const context = makeContext({ env, params: { id: token }, request: new Request('https://example.com' + result.src) });
    const response = await onRequest(context);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('Content-Disposition'), 'inline; filename="file.png"');
    assert.strictEqual(await response.text(), 'hello');
    assert.strictEqual(kv.operations.put.length, 0);
    const forged = await onRequest(makeContext({ ...context, params: { id: token.slice(0, -2) + '!!' } }));
    assert.strictEqual(forged.status, 404);
    const blocked = await onRequest(makeContext({ ...context, env: { ...env, WhiteList_Mode: 'true' } }));
    assert.strictEqual(blocked.status, 302);
    assert.strictEqual(kv.operations.put.length, 0);
  });
});
