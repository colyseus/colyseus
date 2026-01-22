import fs from "fs";
import path from "path";
import util from "util";
import blessed from "blessed";
import WebSocket from "ws";
import timer from "timers/promises"
import minimist from "minimist";

import { Client, Room } from "@colyseus/sdk";

export type RequestJoinOperations = {
    requestNumber?: number,
};

export type Options = {
    endpoint: string,
    roomName: string,
    roomId: string,
    numClients: number,
    delay: number,
    logLevel: string,
    reestablishAllDelay: number,
    retryFailed: number,
    output: string,
    requestJoinOptions?: RequestJoinOperations,
    clientId: number,
};

export type MainCallback = (options: Options) => Promise<void>;

export function cli(main: MainCallback) {
    const logWriter = {
        handle: null as fs.WriteStream,
        isClosing: false as boolean,
        create(filepath: string) {
            if (fs.existsSync(filepath)) {
                const moveTo = `${path.basename(filepath)}.bkp`;
                console.log(`Moving previous "${path.basename(filepath)}" file to "${moveTo}"`);
                fs.renameSync(filepath, path.resolve(path.dirname(filepath), moveTo));
            }
            this.handle = fs.createWriteStream(filepath);
        },

        write(contents: any, close?: boolean) {
            if (!this.handle || this.isClosing) { return; }
            if (close) { this.isClosing = true; }

            return new Promise<void>((resolve, reject) => {
                const now = new Date();
                this.handle.write(`[${now.toLocaleString()}] ${contents}\n`, (err) => {
                    if (err) { return reject(err); }
                    if (this.isClosing) { this.handle.close(); }
                    resolve();
                });

            })
        }
    };

    const argv = minimist(process.argv.slice(2));

    // const packageJson = require("../package.json");
    const packageJson = { name: "@colyseus/loadtest", version: "0.17" };

    function displayHelpAndExit() {
        console.log(`${packageJson.name} v${packageJson.version}

Options:
    --endpoint: WebSocket endpoint for all connections (default: ws://localhost:2567)
    --room: room handler name (you can also use --roomId instead to join by id)
    --roomId: room id (specify instead of --room)
    [--numClients]: number of connections to open (default is 1)
    [--delay]: delay to start each connection (in milliseconds)
    [--project]: specify a tsconfig.json file path
    [--reestablishAllDelay]: delay for closing and re-establishing all connections (in milliseconds)
    [--retryFailed]: delay to retry failed connections (in milliseconds)
    [--output]: specify an output file for output logs

Example:
    colyseus-loadtest example/bot.ts --endpoint ws://localhost:2567 --room state_handler`);
        process.exit();

    }

    if (argv.help) { displayHelpAndExit(); }

    const options: Options = {
        endpoint: argv.endpoint || `ws://localhost:2567`,
        roomName: argv.room,
        roomId: argv.roomId,
        numClients: argv.numClients || 1,
        delay: argv.delay || 0,
        logLevel: argv.logLevel?.toLowerCase() || "all", // TODO: not being used atm
        reestablishAllDelay: argv.reestablishAllDelay || 0,
        retryFailed: argv.retryFailed || 0,
        output: argv.output && path.resolve(argv.output),
        clientId: 0,
    }

    if (!main) {
        console.error("❌ You must specify an entrypoint function.");
        console.error("");
        displayHelpAndExit();
    }

    const connections: Room[] = [];

    if (!options.roomName && !options.roomId) {
        console.error("❌ You need to specify a room with either one of the '--room' or '--roomId' options.");
        console.error("");
        displayHelpAndExit();
    }

    if (options.output) {
        logWriter.create(options.output);
        logWriter.write(`@colyseus/loadtest\n${Object.keys(options)
            .filter(key => options[key])
            .map((key) => `${key}: ${options[key]}`).join('\n')}`)
    }

    const screen = blessed.screen({ smartCSR: true });

    const headerBox = blessed.box({
        label: ` ⚔  ${packageJson.name} ${packageJson.version} ⚔  `,
        top: 0,
        left: 0,
        width: "70%",
        height: 'shrink',
        children: [
            blessed.text({ top: 1, left: 1, tags: true, content: `{yellow-fg}endpoint:{/yellow-fg} ${options.endpoint}` }),
            blessed.text({ top: 2, left: 1, tags: true, content: `{yellow-fg}room:{/yellow-fg} ${options.roomName ?? options.roomId}` }),
            blessed.text({ top: 3, left: 1, tags: true, content: `{yellow-fg}serialization method:{/yellow-fg} ...` }),
            blessed.text({ top: 4, left: 1, tags: true, content: `{yellow-fg}time elapsed:{/yellow-fg} ...` }),
        ],
        border: { type: 'line' },
        style: {
            label: { fg: 'cyan' },
            border: { fg: 'green' }
        }
    });

    const currentStats = {
        connected: 0,
        disconnected: 0,
        failed: 0,
    };

    const totalStats = {
        connected: 0,
        disconnected: 0,
        failed: 0,
        errors: 0,
    };

    const successfulConnectionBox = blessed.text({ top: 2, left: 1, tags: true, content: `{yellow-fg}connected:{/yellow-fg} ${currentStats.connected}` });
    const disconnectedClientsBox = blessed.text({ top: 3, left: 1, tags: true, content: `{yellow-fg}disconnected:{/yellow-fg} ${currentStats.disconnected}` });
    const failedConnectionBox = blessed.text({ top: 4, left: 1, tags: true, content: `{yellow-fg}failed:{/yellow-fg} ${currentStats.failed}` });

    const clientsBox = blessed.box({
        label: ' clients ',
        left: "70%",
        width: "30%",
        height: 'shrink',
        children: [
            blessed.text({ top: 1, left: 1, tags: true, content: `{yellow-fg}numClients:{/yellow-fg} ${options.numClients}` }),
            successfulConnectionBox,
            disconnectedClientsBox,
            failedConnectionBox
        ],
        border: { type: 'line' },
        tags: true,
        style: {
            label: { fg: 'cyan' },
            border: { fg: 'green' },
        }
    })

    const processingBox = blessed.box({
        label: ' processing ',
        top: 7,
        left: "70%",
        width: "30%",
        height: 'shrink',
        border: { type: 'line' },
        children: [
            blessed.text({ top: 1, left: 1, tags: true, content: `{yellow-fg}memory:{/yellow-fg} ...` }),
            blessed.text({ top: 2, left: 1, tags: true, content: `{yellow-fg}cpu:{/yellow-fg} ...` }),
            // blessed.text({ top: 1, left: 1, content: `memory: ${process.memoryUsage().heapUsed} / ${process.memoryUsage().heapTotal}` })
        ],
        tags: true,
        style: {
            label: { fg: 'cyan' },
            border: { fg: 'green' },
        }
    });

    const networkingBox = blessed.box({
        label: ' networking ',
        top: 12,
        left: "70%",
        width: "30%",
        border: { type: 'line' },
        children: [
            blessed.text({ top: 1, left: 1, tags: true, content: `{yellow-fg}bytes received:{/yellow-fg} ...` }),
            blessed.text({ top: 2, left: 1, tags: true, content: `{yellow-fg}bytes sent:{/yellow-fg} ...` }),
            // blessed.text({ top: 1, left: 1, content: `memory: ${process.memoryUsage().heapUsed} / ${process.memoryUsage().heapTotal}` })
        ],
        tags: true,
        style: {
            label: { fg: 'cyan' },
            border: { fg: 'green' },
        }
    });

    const logBox = blessed.box({
        label: ' logs ',
        top: 7,
        width: "70%",
        padding: 1,
        border: { type: 'line' },
        tags: true,
        style: {
            label: { fg: 'cyan' },
            border: { fg: 'green' },
        },
        // scroll
        scrollable: true,
        input: true,
        alwaysScroll: true,
        scrollbar: {
            style: {
                bg: "green"
            },
            track: {
                bg: "gray"
            }
        },
        keys: true,
        vi: true,
        mouse: true
    });

    screen.key(['escape', 'q', 'C-c'], (ch, key) => beforeExit("SIGINT")); // Quit on Escape, q, or Control-C.
    screen.title = "@colyseus/loadtest";
    screen.append(headerBox);
    screen.append(clientsBox);
    screen.append(logBox);
    screen.append(processingBox);
    screen.append(networkingBox);
    screen.render();

    const debug = console.debug;
    const log = console.log;
    const warn = console.warn;
    const info = console.info;
    const error = console.error;

    console.debug = function(...args) {
        logBox.content = `{grey-fg}${args.map(arg => util.inspect(arg)).join(" ")}{/grey-fg}\n${logBox.content}`;
        screen.render();
    };
    console.log = function(...args) {
        logBox.content = args.map(arg => util.inspect(arg)).join(" ") + "\n" + logBox.content;
        screen.render();
    };
    console.warn = function(...args) {
        logBox.content = `{yellow-fg}${args.map(arg => util.inspect(arg)).join(" ")}{/yellow-fg}\n${logBox.content}`;
        screen.render();
    };
    console.info = function(...args) {
        logBox.content = `{blue-fg}${args.map(arg => util.inspect(arg)).join(" ")}{/blue-fg}\n${logBox.content}`;
        screen.render();
    };
    console.error = function(...args) {
        totalStats.errors++;
        logBox.content = `{red-fg}${args.map(arg => util.inspect(arg)).join(" ")}{/red-fg}\n${logBox.content}`;
        screen.render();
    };

    process.on("uncaughtException", (e) => {
        console.error(e);
    });

    let isExiting = false;
    async function beforeExit(signal: NodeJS.Signals, closeCode: number = 0) {
        log("Writing log file...");

        if (isExiting) {
            return;

        } else {
            isExiting = true;
        }

        const hasError = (closeCode > 0);

        await logWriter.write(`Finished. Summary:
    Successful connections: ${totalStats.connected}
    Failed connections: ${totalStats.failed}
    Total errors: ${totalStats.errors}
    Logs:
    ${logBox.content}`, true /* closing */)

        process.exit(hasError ? 1 : 0);
    }

    // trap process signals
    process.once('exit', (code) => beforeExit("SIGINT", code));
    ['SIGINT', 'SIGTERM', 'SIGUSR2'].forEach((signal) =>
        process.once(signal as NodeJS.Signals, (signal) => beforeExit(signal)));

    function formatBytes (bytes) {
        if (bytes < 1024) {
            return `${bytes} b`;

        } else if (bytes < Math.pow(1024, 2)) {
            return `${(bytes / 1024).toFixed(2)} kb`;

        } else if (bytes < Math.pow(1024, 4)) {
            return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
        }
    }

    function elapsedTime(inputSeconds) {
        const days = Math.floor(inputSeconds / (60 * 60 * 24));
        const hours = Math.floor((inputSeconds % (60 * 60 * 24)) / (60 * 60));
        const minutes = Math.floor(((inputSeconds % (60 * 60 * 24)) % (60 * 60)) / 60);
        const seconds = Math.floor(((inputSeconds % (60 * 60 * 24)) % (60 * 60)) % 60);

        let ddhhmmss = '';

        if (days > 0) { ddhhmmss += days + ' day '; }
        if (hours > 0) { ddhhmmss += hours + ' hour '; }
        if (minutes > 0) { ddhhmmss += minutes + ' minutes '; }
        if (seconds > 0) { ddhhmmss += seconds + ' seconds '; }

        return ddhhmmss || "...";
    }

    /**
     * Update memory / cpu usage
     */
    const loadTestStartTime = Date.now();
    let startTime = process.hrtime()
    let startUsage = process.cpuUsage()
    let bytesReceived: number = 0;
    let bytesSent: number = 0;
    setInterval(() => {
        /**
         * Program elapsed time
         */
        const elapsedTimeText = (headerBox.children[3] as blessed.Widgets.TextElement);
        elapsedTimeText.content = `{yellow-fg}time elapsed:{/yellow-fg} ${elapsedTime(Math.round((Date.now() - loadTestStartTime) / 1000))}`;

        /**
         * Memory / CPU Usage
         */
        const memoryText = (processingBox.children[0] as blessed.Widgets.TextElement);
        memoryText.content = `{yellow-fg}memory:{/yellow-fg} ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`;

        var elapTime = process.hrtime(startTime)
        var elapUsage = process.cpuUsage(startUsage)

        var elapTimeMS = elapTime[0] * 1000 + elapTime[1] / 1000000;
        var elapUserMS = elapUsage.user / 1000;
        var elapSystMS = elapUsage.system / 1000;
        var cpuPercent = (100 * (elapUserMS + elapSystMS) / elapTimeMS).toFixed(1);

        const cpuText = (processingBox.children[1] as blessed.Widgets.TextElement);
        cpuText.content = `{yellow-fg}cpu:{/yellow-fg} ${cpuPercent}%`;

        screen.render();

        startTime = process.hrtime()
        startUsage = process.cpuUsage()

        /**
         * Networking
         */
        const bytesReceivedBox = (networkingBox.children[0] as blessed.Widgets.TextElement);
        bytesReceivedBox.content = `{yellow-fg}bytes received:{/yellow-fg} ${formatBytes(bytesReceived)}`

        const bytesSentBox = (networkingBox.children[1] as blessed.Widgets.TextElement);
        bytesSentBox.content = `{yellow-fg}bytes sent:{/yellow-fg} ${formatBytes(bytesSent)}`
    }, 1000);

    function handleError (message) {
        if (message) {
            console.error(message);
            logWriter.write(message);
        }

        currentStats.failed++;
        totalStats.failed++;

        failedConnectionBox.content = `{red-fg}failed:{/red-fg} ${currentStats.failed}`;
        screen.render();
    }

    async function connect(main: MainCallback, i: number) {
        try {
            await main({ ...options, clientId: i });
        } catch (e) {
            handleError(e);
        }
    }

    async function connectAll(main: MainCallback) {
        for (let i = 0; i < options.numClients; i++) {
            await connect(main, i);

            if (options.delay > 0) {
                await timer.setTimeout(options.delay);
            }
        }
    }

    async function reestablishAll(scripting: any) {
        // drop all connections, wait for acknowledgement
        connections.map((connection) => connection.connection.close());

        // clear array
        connections.splice(0, connections.length);
        connections.length = 0;

        // connect again
        await connectAll(scripting);
    }

    const handleClientJoin = function(room: Room) {
        // display serialization method in the UI
        const serializerIdText = (headerBox.children[2] as blessed.Widgets.TextElement);
        serializerIdText.content = `{yellow-fg}serialization method:{/yellow-fg} ${room.serializerId}`;

        const ws: WebSocket = (room.connection.transport as any).ws;
        ws.addEventListener('message', (event) => {
            bytesReceived += new Uint8Array(event.data).length;
        });

        // overwrite original send function to trap sent bytes.
        const _send = ws.send;
        ws.send = function (data: ArrayBuffer) {
            if (ws.readyState == 1) {
                bytesSent += data.byteLength;
            }
            _send.call(ws, data);
        }

        currentStats.connected++;
        totalStats.connected++;
        successfulConnectionBox.content = `{yellow-fg}connected:{/yellow-fg} ${currentStats.connected}`;
        screen.render();

        // update stats on leave
        room.onLeave(() => {
            currentStats.disconnected++;
            totalStats.disconnected++;
            disconnectedClientsBox.content = `{yellow-fg}disconnected:{/yellow-fg} ${currentStats.disconnected}`;
            screen.render();
        });

        connections.push(room);
    }

    const _originalJoinOrCreate = Client.prototype.joinOrCreate;
    Client.prototype.joinOrCreate = async function(this: typeof Client) {
        const room = await _originalJoinOrCreate.apply(this, arguments as any);
        handleClientJoin(room);
        return room;
    }

    const _originalCreate = Client.prototype.create;
    Client.prototype.create = async function(this: typeof Client) {
        const room = await _originalCreate.apply(this, arguments as any);
        handleClientJoin(room);
        return room;
    }

    const _originalJoin = Client.prototype.join;
    Client.prototype.join = async function(this: typeof Client) {
        const room = await _originalJoin.apply(this, arguments as any);
        handleClientJoin(room);
        return room;
    }

    const _originalJoinById = Client.prototype.joinById;
    Client.prototype.joinById = async function(this: typeof Client) {
        const room = await _originalJoinById.apply(this, arguments as any);
        handleClientJoin(room);
        return room;
    }

    try {
        (async () => {
            await connectAll(main);

            if (options.reestablishAllDelay > 0) {
                while (true) {
                    // wait for delay
                    await timer.setTimeout(options.reestablishAllDelay);

                    await reestablishAll(main);
                }
            }
        })();

    } catch (e: any) {
        error(e.stack);
    }
}
