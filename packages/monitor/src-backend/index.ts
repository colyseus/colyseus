import express from 'express';
import path from 'path';

// required for ESM support. (esbuild uses it)
import { fileURLToPath } from 'url';

import { getAPI } from './api.js';
import './ext/Room.js';

const frontendDirectory = path.resolve(__dirname, "..", "build", "static");

export interface MonitorOptions {
    columns: Array<
        'roomId' |
        'name' |
        'clients' |
        'maxClients' |
        'locked' |
        'elapsedTime' |
        { metadata: string } |
        'processId' |
        "publicAddress"
    >
}

export function monitor (opts: Partial<MonitorOptions> = {}): express.Router {
    const router = express.Router();
    router.use(express.static(frontendDirectory));
    router.use('/api', getAPI(opts));
    return router;
}
