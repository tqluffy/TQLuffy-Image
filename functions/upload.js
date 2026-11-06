import { errorHandling, telemetryData } from "./utils/middleware.js";
import { authenticateUploadRequest } from "./utils/auth.js";
import { jsonResponse } from "./utils/http.js";
import { createDefaultMetadata, putMetadata } from "./utils/metadata.js";
import { allocateShortId, isShortUrlsEnabled, putShortLink } from "./utils/shortlink.js";
import { getUploadProvider } from "./storage/index.js";
import { getStatelessKeys, sealFileId } from "./utils/stateless.js";

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const authResponse = authenticateUploadRequest(request, env);
        if (authResponse) {
            return authResponse;
        }

        const provider = getUploadProvider(env);
        provider.validateConfig(env);

        const clonedRequest = request.clone();
        const formData = await clonedRequest.formData();
        const noKv = formData.get('no_kv') === 'true';
        let keyId, secret;
        if (noKv) {
            keyId = formData.get('key_id');
            if (typeof keyId !== 'string' || !/^[A-Za-z0-9]{4}$/.test(keyId)) {
                return jsonResponse({ error: 'key_id must contain exactly four letters or digits' }, { status: 400 });
            }
            let keys;
            try { keys = getStatelessKeys(env); }
            catch { return jsonResponse({ error: 'Stateless key configuration is invalid' }, { status: 503 }); }
            secret = keys.get(keyId);
            if (!secret) return jsonResponse({ error: 'Unknown key_id' }, { status: 400 });
        }

        await errorHandling(context);
        telemetryData(context);

        const uploadFile = formData.get('file');
        if (!uploadFile) {
            throw new Error('No file uploaded');
        }

        const fileName = uploadFile.name;
        const fileExtension = fileName.split('.').pop().toLowerCase();

        const longId = await provider.upload(env, uploadFile, { fileName, fileExtension });
        if (noKv) {
            const token = await sealFileId(secret, longId);
            return jsonResponse([{
                src: `/file-stateless/${keyId}.${token}`,
                key_id: keyId,
                metadata: createDefaultMetadata(longId, { fileName, fileSize: uploadFile.size, provider: provider.key }),
            }]);
        }
        let shortId = null;

        // 将文件信息保存到 KV 存储
        if (env.img_url) {
            if (isShortUrlsEnabled(env)) {
                shortId = await allocateShortId(env);
            }

            await putMetadata(env, longId, createDefaultMetadata(longId, {
                fileName,
                fileSize: uploadFile.size,
                provider: provider.key,
                ...(shortId ? { shortId } : {}),
            }));

            if (shortId) {
                await putShortLink(env, shortId, longId);
            }
        }

        return jsonResponse([{ 'src': `/file/${shortId || longId}` }]);
    } catch (error) {
        console.error('Upload error:', error);
        return jsonResponse({ error: error.message }, { status: 500 });
    }
}
