async function keyFromSecret(secret) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
    return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealFileId(secret, id) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFromSecret(secret), new TextEncoder().encode(id)));
    const bytes = new Uint8Array(iv.length + encrypted.length);
    bytes.set(iv); bytes.set(encrypted, iv.length);
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function openFileId(secret, token) {
    if (!secret || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
    try {
        const bytes = Uint8Array.from(atob(token.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await keyFromSecret(secret), bytes.slice(12));
        return new TextDecoder().decode(plain);
    } catch { return null; }
}
