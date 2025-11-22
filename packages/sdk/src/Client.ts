import type { SDKTypes, Room as ServerRoom } from '@colyseus/core';

import { ServerError } from './errors/Errors.ts';
import { Room } from './Room.ts';
import { SchemaConstructor } from './serializer/SchemaSerializer.ts';
import { HTTP } from './HTTP.ts';
import { Auth } from './Auth.ts';
import { SeatReservation } from './Protocol.ts';
import { discordURLBuilder } from './3rd_party/discord.ts';

export type JoinOptions = any;

export class MatchMakeError extends Error {
    code: number;
    constructor(message: string, code: number) {
        super(message);
        this.code = code;
        this.name = "MatchMakeError";
        Object.setPrototypeOf(this, MatchMakeError.prototype);
    }
}

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
}

export interface ClientOptions {
    headers?: { [id: string]: string };
    urlBuilder?: (url: URL) => string;
}

export class ColyseusSDK<ServerType extends SDKTypes = any> {
    static VERSION = process.env.VERSION;

    public http: HTTP<ServerType['~routes']>;
    public auth: Auth;

    protected settings: EndpointSettings;
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

    // Overload: Use room name from ServerType to infer room type
    public async joinOrCreate<R extends keyof ServerType['~rooms']>(
        roomName: R,
        options?: Parameters<ServerType['~rooms'][R]['~room']['prototype']['onJoin']>[1],
        rootSchema?: SchemaConstructor<ServerType>
    ): Promise<Room<ServerType['~rooms'][R]['~room']>>
    // Overload: Pass RoomType directly to extract state
    public async joinOrCreate<RoomType extends typeof ServerRoom>(
        roomName: string,
        options?: Parameters<RoomType['prototype']['onJoin']>[1],
        rootSchema?: SchemaConstructor<RoomType['prototype']['state']>
    ): Promise<Room<RoomType>>
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
    public async create<R extends keyof ServerType['~rooms']>(
        roomName: R,
        options?: Parameters<ServerType['~rooms'][R]['~room']['prototype']['onJoin']>[1],
        rootSchema?: SchemaConstructor<ServerType>
    ): Promise<Room<ServerType['~rooms'][R]['~room']>>
    // Overload: Pass RoomType directly to extract state
    public async create<RoomType extends typeof ServerRoom>(
        roomName: string,
        options?: Parameters<RoomType['prototype']['onJoin']>[1],
        rootSchema?: SchemaConstructor<RoomType['prototype']['state']>
    ): Promise<Room<RoomType>>
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
    public async join<R extends keyof ServerType['~rooms']>(
        roomName: R,
        options?: Parameters<ServerType['~rooms'][R]['~room']['prototype']['onJoin']>[1],
        rootSchema?: SchemaConstructor<ServerType>
    ): Promise<Room<ServerType['~rooms'][R]['~room']>>
    // Overload: Pass RoomType directly to extract state
    public async join<RoomType extends typeof ServerRoom>(
        roomName: string,
        options?: Parameters<RoomType['prototype']['onJoin']>[1],
        rootSchema?: SchemaConstructor<RoomType['prototype']['state']>
    ): Promise<Room<RoomType>>
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
    public async joinById<R extends keyof ServerType['~rooms']>(
        roomName: R,
        options?: Parameters<ServerType['~rooms'][R]['~room']['prototype']['onJoin']>[1],
        rootSchema?: SchemaConstructor<ServerType>
    ): Promise<Room<ServerType['~rooms'][R]['~room']>>
    // Overload: Pass RoomType directly to extract state
    public async joinById<RoomType extends typeof ServerRoom>(
        roomId: string,
        options?: Parameters<RoomType['prototype']['onJoin']>[1],
        rootSchema?: SchemaConstructor<RoomType['prototype']['state']>
    ): Promise<Room<RoomType>>
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
    public async reconnect<RoomType extends typeof ServerRoom>(
        reconnectionToken: string,
        rootSchema?: SchemaConstructor<RoomType['prototype']['state']>
    ): Promise<Room<RoomType>>
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
        response: SeatReservation,
        rootSchema?: SchemaConstructor<T>
    ): Promise<Room<any, T>> {
        const room = this.createRoom<T>(response.room.name, rootSchema);
        room.roomId = response.room.roomId;
        room.sessionId = response.sessionId;

        const options: any = { sessionId: room.sessionId };

        // forward "reconnection token" in case of reconnection.
        if (response.reconnectionToken) {
            options.reconnectionToken = response.reconnectionToken;
        }

        room.connect(
            this.buildEndpoint(response.room, options, response.protocol),
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

    protected async createMatchMakeRequest<T>(
        method: string,
        roomName: string,
        options: JoinOptions = {},
        rootSchema?: SchemaConstructor<T>,
    ) {
        const response = (
            await (this.http as HTTP<any>).post(`/matchmake/${method}/${roomName}`, {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: options
            })
        ).data as unknown as SeatReservation;

        // FIXME: HTTP class is already handling this as ServerError.
        // @ts-ignore
        if (response.error) { throw new MatchMakeError(response.error, response.code); }

        // forward reconnection token during "reconnect" methods.
        if (method === "reconnect") {
            response.reconnectionToken = options.reconnectionToken;
        }

        return await this.consumeSeatReservation<T>(response, rootSchema);
    }

    protected createRoom<T>(roomName: string, rootSchema?: SchemaConstructor<T>) {
        return new Room<any, T>(roomName, rootSchema);
    }

    protected buildEndpoint(room: any, options: any = {}, protocol: string = "ws") {
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

        if (room.publicAddress) {
            endpoint += `${room.publicAddress}`;

        } else {
            endpoint += `${this.settings.hostname}${this.getEndpointPort()}${this.settings.pathname}`;
        }

        const endpointURL = `${endpoint}/${room.processId}/${room.roomId}?${searchParams}`;
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