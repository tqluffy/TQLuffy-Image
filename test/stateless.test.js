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
      STATELESS_LINK_KEYS: JSON.stringify([{ id: 'a1B2', secret: 'another secret' }]),
      img_r2: {
        async put(key, data) { objects.set(key, data); },
        async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; },
      },
    };
    const form = new FormData();
    form.append('file', new File(['hello'], 'test.png', { type: 'image/png' }));
    form.append('no_kv', 'true');
    form.append('key_id', 'TEST');
    const upload = await onRequestPost(makeContext({ env, request: new Request('https://example.com/upload', { method: 'POST', body: form }) }));
    assert.strictEqual(upload.status, 200);
    const [result] = await upload.json();
    assert.strictEqual(result.metadata.fileName, 'test.png');
    assert.strictEqual(result.metadata.fileSize, 5);
    assert.strictEqual(kv.operations.put.length, 0);
    const token = result.src.split('/').pop();
    assert.strictEqual(result.key_id, 'TEST');
    assert.ok(token.startsWith('TEST.'));
    const context = makeContext({ env, params: { id: token }, request: new Request('https://example.com' + result.src) });
    const response = await onRequest(context);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('Content-Disposition'), 'inline; filename="file.png"');
    assert.strictEqual(await response.text(), 'hello');
    assert.strictEqual(kv.operations.put.length, 0);
    const legacy = await onRequest(makeContext({ ...context, params: { id: token.slice(5) } }));
    assert.strictEqual(legacy.status, 200);
    const wrongKey = await onRequest(makeContext({ ...context, params: { id: 'a1B2.' + token.slice(5) } }));
    assert.strictEqual(wrongKey.status, 404);
    const forged = await onRequest(makeContext({ ...context, params: { id: token.slice(0, -2) + '!!' } }));
    assert.strictEqual(forged.status, 404);
    const blocked = await onRequest(makeContext({ ...context, env: { ...env, WhiteList_Mode: 'true' } }));
    assert.strictEqual(blocked.status, 302);
    assert.strictEqual(kv.operations.put.length, 0);
  });

  it('validates key ids and supports a second configured key', async function () {
    const { onRequestPost } = await import('../functions/upload.js');
    const { onRequest } = await import('../functions/file-stateless/[id].js');
    const objects = new Map();
    const env = { disable_telemetry: 'true', STORAGE_PROVIDER: 'r2',
      STATELESS_LINK_SECRET: 'old secret', STATELESS_LINK_KEYS: JSON.stringify([{ id: 'Ab19', secret: 'new secret' }]),
      img_r2: { async put(k, v) { objects.set(k, v); }, async get(k) { return objects.has(k) ? { body: objects.get(k) } : null; } } };
    async function upload(keyId, currentEnv = env) {
      const form = new FormData();
      form.append('file', new File(['x'], 'x.png', { type: 'image/png' }));
      form.append('no_kv', 'true');
      if (keyId !== null) form.append('key_id', keyId);
      return onRequestPost(makeContext({ env: currentEnv, request: new Request('https://example.com/upload', { method: 'POST', body: form }) }));
    }
    for (const id of [null, '', 'bad', '****', 'NONE']) assert.strictEqual((await upload(id)).status, 400);
    assert.strictEqual(objects.size, 0);
    assert.strictEqual((await upload('TEST', { ...env, STATELESS_LINK_KEYS: '[{"id":"TEST","secret":"duplicate"}]' })).status, 503);
    const response = await upload('Ab19');
    const [item] = await response.json();
    assert.strictEqual(response.status, 200);
    assert.ok(item.src.startsWith('/file-stateless/Ab19.'));
    const download = await onRequest(makeContext({ env, params: { id: item.src.split('/').pop() }, request: new Request('https://example.com' + item.src) }));
    assert.strictEqual(await download.text(), 'x');
  });
});
