import { CloseCode, Protocol, type InferState, type SDKTypes, type ServerRoomLike, type ISeatReservation } from '@colyseus/shared-types';

import { MatchMakeError, ServerError } from './errors/Errors.ts';
import { Room } from './Room.ts';
import { SchemaConstructor } from './serializer/SchemaSerializer.ts';
import { HTTP } from './HTTP.ts';
import { Auth } from './Auth.ts';
import { Connection } from './Connection.ts';
import { discordURLBuilder } from './3rd_party/discord.ts';

export type JoinOptions = any;
export type { ISeatReservation };

// - React Native does not provide `window.location`
// - Cocos Creator (Native) does not provide `window.location.hostname`
const DEFAULT_ENDPOINT = (typeof (window) !== "undefined" &&  typeof (window?.location?.hostname) !== "undefined")
    ? `${window.location.protocol.replace("http", "ws")}//${window.location.hostname}${(window.location.port && `:${window.location.port}`)}`
    : "ws://127.0.0.1:2567";

export interface EndpointSettings {
    hostname: string,
    secure: boolean,
    port?: number,
    pathname?: string,
    searchParams?: string,
    protocol?: "ws" | "h3";
}

export interface ClientOptions {
    headers?: { [id: string]: string };
    urlBuilder?: (url: URL) => string;
    protocol?: "ws" | "h3";
}

export interface LatencyOptions {
    /** "ws" for WebSocket, "h3" for WebTransport (default: "ws") */
    protocol?: "ws" | "h3";
    /** Number of pings to send (default: 1). Returns the average latency when > 1. */
    pingCount?: number;
}

export class ColyseusSDK<ServerType extends SDKTypes = any, UserData = any> {
    static VERSION = "0.17";

    /**
     * The HTTP client to make requests to the server.
     */
    public http: HTTP<ServerType['~routes']>;

    /**
     * The authentication module to authenticate into requests and rooms.
     */
    public auth: Auth<UserData>;

    /**
     * The settings used to connect to the server.
     */
    public settings: EndpointSettings;

    protected urlBuilder: (url: URL) => string;

    constructor(
        settings: string | EndpointSettings = DEFAULT_ENDPOINT,
        options?: ClientOptions,
    ) {
        if (typeof (settings) === "string") {

            //
            // endpoint by url
            //
            const url = (settings.startsWith("/"))
                ? new URL(settings, DEFAULT_ENDPOINT)
                : new URL(settings);

            const secure = (url.protocol === "https:" || url.protocol === "wss:");
            const port = Number(url.port || (secure ? 443 : 80));

            this.settings = {
                hostname: url.hostname,
                pathname: url.pathname,
                port,
                secure,
                searchParams: url.searchParams.toString() || undefined,
            };

        } else {
            //
            // endpoint by settings
            //
            if (settings.port === undefined) {
                settings.port = (settings.secure) ? 443 : 80;
            }
            if (settings.pathname === undefined) {
                settings.pathname = "";
            }
            this.settings = settings;
        }

        // make sure pathname does not end with "/"
        if (this.settings.pathname.endsWith("/")) {
            this.settings.pathname = this.settings.pathname.slice(0, -1);
        }

        // specify room connection protocol if provided
        if (options?.protocol) {
            this.settings.protocol = options.protocol;
        }

        this.http = new HTTP(this, {
            headers: options?.headers || {},
        });
        this.auth = new Auth(this.http);

        this.urlBuilder = options?.urlBuilder;

        //
        // Discord Embedded SDK requires a custom URL builder
        //
        if (
            !this.urlBuilder &&
            typeof (window) !== "undefined" &&
            window?.location?.hostname?.includes("discordsays.com")
        ) {
            this.urlBuilder = discordURLBuilder;
            console.log("Colyseus SDK: Discord Embedded SDK detected. Using custom URL builder.");
        }
    }

    /**
     * Select the endpoint with the lowest latency.
     * @param endpoints Array of endpoints to select from.
     * @param options Client options.
     * @param latencyOptions Latency measurement options (protocol, pingCount).
     * @returns The client with the lowest latency.
     */
    static async selectByLatency<ServerType extends SDKTypes = any, UserData = any>(
        endpoints: Array<string | EndpointSettings>,
        options?: ClientOptions,
        latencyOptions: LatencyOptions = {}
    ) {
        const clients = endpoints.map(endpoint => new ColyseusSDK<ServerType, UserData>(endpoint, options));

        const latencies = (await Promise.allSettled(clients.map((client, index) => client.getLatency(latencyOptions).then(latency => {
            const settings = clients[index].settings;
            console.log(`🛜 Endpoint Latency: ${latency}ms - ${settings.hostname}:${settings.port}${settings.pathname}`);
            return [index, latency]
        }))))
            .filter((result) => result.status === 'fulfilled')
            .map(result => result.value);

        if (latencies.length === 0) {
            throw new Error('All endpoints failed to respond');
        }

        return clients[latencies.sort((a, b) => a[1] - b[1])[0][0]];
    }

    // Overload: Use room name from ServerType to infer room type
    public async joinOrCreate<R extends keyof ServerType['~rooms'], State = InferState<ServerType['~rooms'][R]['~room'], never>>(
        roomName: R,
        options?: Parameters<ServerType['~rooms'][R]['~room']['onJoin']>[1],
        rootSchema?: SchemaConstructor<State>
    ): Promise<Room<ServerType['~rooms'][R]['~room'], State>>
    // Overload: Pass RoomType directly to extract state
    public async joinOrCreate<RoomType extends ServerRoomLike>(
        roomName: string,
        options?: Parameters<NonNullable<RoomType['onJoin']>>[1],
        rootSchema?: SchemaConstructor<RoomType['state']>
    ): Promise<Room<RoomType, RoomType['state']>>
    // Overload: Pass State type directly
    public async joinOrCreate<State = any>(
        roomName: string,
        options?: JoinOptions,
        rootSchema?: SchemaConstructor<State>
    ): Promise<Room<any, State>>
    // Implementation
    public async joinOrCreate<T = any>(roomName: string, options: JoinOptions = {}, rootSchema?: SchemaConstructor<T>) {
        return await this.createMatchMakeRequest<T>('joinOrCreate', roomName, options, rootSchema);
    }

    // Overload: Use room name from ServerType to infer room type
    public async create<R extends keyof ServerType['~rooms'], State = InferState<ServerType['~rooms'][R]['~room'], never>>(
        roomName: R,
        options?: Parameters<ServerType['~rooms'][R]['~room']['onJoin']>[1],
        rootSchema?: SchemaConstructor<State>
    ): Promise<Room<ServerType['~rooms'][R]['~room'], State>>
    // Overload: Pass RoomType directly to extract state
    public async create<RoomType extends ServerRoomLike>(
        roomName: string,
        options?: Parameters<NonNullable<RoomType['onJoin']>>[1],
        rootSchema?: SchemaConstructor<RoomType['state']>
    ): Promise<Room<RoomType, RoomType['state']>>
    // Overload: Pass State type directly
    public async create<State = any>(
        roomName: string,
        options?: JoinOptions,
        rootSchema?: SchemaConstructor<State>
    ): Promise<Room<any, State>>
    // Implementation
    public async create<T = any>(roomName: string, options: JoinOptions = {}, rootSchema?: SchemaConstructor<T>) {
        return await this.createMatchMakeRequest<T>('create', roomName, options, rootSchema);
    }

    // Overload: Use room name from ServerType to infer room type
    public async join<R extends keyof ServerType['~rooms'], State = InferState<ServerType['~rooms'][R]['~room'], never>>(
        roomName: R,
        options?: Parameters<ServerType['~rooms'][R]['~room']['onJoin']>[1],
        rootSchema?: SchemaConstructor<State>
    ): Promise<Room<ServerType['~rooms'][R]['~room'], State>>
    // Overload: Pass RoomType directly to extract state
    public async join<RoomType extends ServerRoomLike>(
        roomName: string,
        options?: Parameters<NonNullable<RoomType['onJoin']>>[1],
        rootSchema?: SchemaConstructor<RoomType['state']>
    ): Promise<Room<RoomType, RoomType['state']>>
    // Overload: Pass State type directly
    public async join<State = any>(
        roomName: string,
        options?: JoinOptions,
        rootSchema?: SchemaConstructor<State>
    ): Promise<Room<any, State>>
    // Implementation
    public async join<T = any>(roomName: string, options: JoinOptions = {}, rootSchema?: SchemaConstructor<T>) {
        return await this.createMatchMakeRequest<T>('join', roomName, options, rootSchema);
    }

    // Overload: Use room name from ServerType to infer room type
    public async joinById<R extends keyof ServerType['~rooms'], State = InferState<ServerType['~rooms'][R]['~room'], never>>(
        roomName: R,
        options?: Parameters<ServerType['~rooms'][R]['~room']['onJoin']>[1],
        rootSchema?: SchemaConstructor<State>
    ): Promise<Room<ServerType['~rooms'][R]['~room'], State>>
    // Overload: Pass RoomType directly to extract state
    public async joinById<RoomType extends ServerRoomLike>(
        roomId: string,
        options?: Parameters<NonNullable<RoomType['onJoin']>>[1],
        rootSchema?: SchemaConstructor<RoomType['state']>
    ): Promise<Room<RoomType, RoomType['state']>>
    // Overload: Pass State type directly
    public async joinById<State = any>(
        roomId: string,
        options?: JoinOptions,
        rootSchema?: SchemaConstructor<State>
    ): Promise<Room<any, State>>
    // Implementation
    public async joinById<T = any>(roomId: string, options: JoinOptions = {}, rootSchema?: SchemaConstructor<T>) {
        return await this.createMatchMakeRequest<T>('joinById', roomId, options, rootSchema);
    }

    /**
     * Re-establish connection with a room this client was previously connected to.
     *
     * @param reconnectionToken The `room.reconnectionToken` from previously connected room.
     * @param rootSchema (optional) Concrete root schema definition
     * @returns Promise<Room>
     */
    // Overload: Use room name from ServerType to infer room type
    public async reconnect<R extends keyof ServerType['~rooms']>(reconnectionToken: string, roomName?: R): Promise<Room<ServerType['~rooms'][R]['~room']>>
    // Overload: Pass RoomType directly to extract state
    public async reconnect<RoomType extends ServerRoomLike>(
        reconnectionToken: string,
        rootSchema?: SchemaConstructor<RoomType['state']>
    ): Promise<Room<RoomType, RoomType['state']>>
    // Overload: Pass State type directly
    public async reconnect<State = any>(
        reconnectionToken: string,
        rootSchema?: SchemaConstructor<State>
    ): Promise<Room<any, State>>
    // Implementation
    public async reconnect<T = any>(reconnectionToken: string, rootSchema?: SchemaConstructor<T>) {
        if (typeof (reconnectionToken) === "string" && typeof (rootSchema) === "string") {
            throw new Error("DEPRECATED: .reconnect() now only accepts 'reconnectionToken' as argument.\nYou can get this token from previously connected `room.reconnectionToken`");
        }
        const [roomId, token] = reconnectionToken.split(":");
		if (!roomId || !token) {
			throw new Error("Invalid reconnection token format.\nThe format should be roomId:reconnectionToken");
		}
        return await this.createMatchMakeRequest<T>('reconnect', roomId, { reconnectionToken: token }, rootSchema);
    }

    public async consumeSeatReservation<T>(
        response: ISeatReservation,
        rootSchema?: SchemaConstructor<T>
    ): Promise<Room<any, T>> {
        const room = this.createRoom<T>(response.name, rootSchema);
        room.roomId = response.roomId;
        room.sessionId = response.sessionId;

        const options: any = { sessionId: room.sessionId };

        // forward "reconnection token" in case of reconnection.
        if (response.reconnectionToken) {
            options.reconnectionToken = response.reconnectionToken;
        }

        room.connect(
            this.buildEndpoint(response, options),
            response,
            this.http.options.headers
        );

        return new Promise((resolve, reject) => {
            const onError = (code, message) => reject(new ServerError(code, message));
            room.onError.once(onError);

            room['onJoin'].once(() => {
                room.onError.remove(onError);
                resolve(room);
            });
        });
    }

    /**
     * Create a new connection with the server, and measure the latency.
     * @param options Latency measurement options (protocol, pingCount).
     */
    public getLatency(options: LatencyOptions = {}): Promise<number> {
        const protocol = options.protocol ?? "ws";
        const pingCount = options.pingCount ?? 1;

        return new Promise<number>((resolve, reject) => {
            const conn = new Connection(protocol);
            const latencies: number[] = [];
            let pingStart = 0;

            conn.events.onopen = () => {
                pingStart = Date.now();
                conn.send(new Uint8Array([Protocol.PING]));
            };

            conn.events.onmessage = (_: MessageEvent) => {
                latencies.push(Date.now() - pingStart);

                if (latencies.length < pingCount) {
                    // Send another ping
                    pingStart = Date.now();
                    conn.send(new Uint8Array([Protocol.PING]));
                } else {
                    // Done, calculate average and close
                    conn.close();
                    const average = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
                    resolve(average);
                }
            };

            conn.events.onerror = (event: ErrorEvent) => {
                reject(new ServerError(CloseCode.ABNORMAL_CLOSURE, `Failed to get latency: ${event.message}`));
            };

            conn.connect(this.getHttpEndpoint());
        });
    }

    protected async createMatchMakeRequest<T>(
        method: string,
        roomName: string,
        options: JoinOptions = {},
        rootSchema?: SchemaConstructor<T>,
    ) {
        try {
            const httpResponse = await (this.http as HTTP<any>).post(`/matchmake/${method}/${roomName}`, {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: options
            });

            const response = httpResponse.data as unknown as ISeatReservation;

            // forward reconnection token during "reconnect" methods.
            if (method === "reconnect") {
                response.reconnectionToken = options.reconnectionToken;
            }

            return await this.consumeSeatReservation<T>(response, rootSchema);
        } catch (error) {
            if (error instanceof ServerError) {
                throw new MatchMakeError(error.message, error.code);
            }
            throw error;
        }
    }

    protected createRoom<T>(roomName: string, rootSchema?: SchemaConstructor<T>) {
        return new Room<any, T>(roomName, rootSchema);
    }

    protected buildEndpoint(seatReservation: ISeatReservation, options: any = {}) {
        let protocol: string = this.settings.protocol || "ws";
        let searchParams = this.settings.searchParams || "";

        // forward authentication token
        if (this.http.authToken) {
            options['_authToken'] = this.http.authToken;
        }

        // append provided options
        for (const name in options) {
            if (!options.hasOwnProperty(name)) {
                continue;
            }
            searchParams += (searchParams ? '&' : '') + `${name}=${options[name]}`;
        }

        if (protocol === "h3") {
            protocol = "http";
        }

        let endpoint = (this.settings.secure)
            ? `${protocol}s://`
            : `${protocol}://`;

        if (seatReservation.publicAddress) {
            endpoint += `${seatReservation.publicAddress}`;

        } else {
            endpoint += `${this.settings.hostname}${this.getEndpointPort()}${this.settings.pathname}`;
        }

        const endpointURL = `${endpoint}/${seatReservation.processId}/${seatReservation.roomId}?${searchParams}`;
        return (this.urlBuilder)
            ? this.urlBuilder(new URL(endpointURL))
            : endpointURL;
    }

    protected getHttpEndpoint(segments: string = '') {
        const path = segments.startsWith("/") ? segments : `/${segments}`;

        let endpointURL = `${(this.settings.secure) ? "https" : "http"}://${this.settings.hostname}${this.getEndpointPort()}${this.settings.pathname}${path}`;

        if (this.settings.searchParams) {
            endpointURL += `?${this.settings.searchParams}`;
        }

        return (this.urlBuilder)
            ? this.urlBuilder(new URL(endpointURL))
            : endpointURL;
    }

    protected getEndpointPort() {
        return (this.settings.port !== 80 && this.settings.port !== 443)
            ? `:${this.settings.port}`
            : "";
    }
}

export const Client = ColyseusSDK;
export type Client<ServerType extends SDKTypes = any, UserData = any> = InstanceType<typeof ColyseusSDK<ServerType, UserData>>;