import { serveFile } from '../file/[id].js';

export function onRequest(context) {
    return serveFile(context, true);
}
