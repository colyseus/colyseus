import express from 'express';
import path from "path";

import { getAPI } from './api';
import './ext/Room';

const frontendDirectory = path.resolve(__dirname, "..", "lib", "static");

export interface MonitorOptions {
    columns: Array<
        'roomId' |
        'name' |
        'clients' |
        'maxClients' |
        'locked' |
        'elapsedTime' |
        { metadata: string }
    >
}

/**
 * TODO: expose the `router` instead on next major version.
 */
export function monitor (opts: Partial<MonitorOptions> = {}): express.Router {
    const router = express.Router();
    router.use('/', express.static(frontendDirectory));
    router.use('/api', getAPI(opts));
    return router;
}
