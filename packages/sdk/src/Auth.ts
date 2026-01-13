import { HTTP } from "./HTTP.ts";
import { getItem, removeItem, setItem } from "./Storage.ts";
import { createNanoEvents } from './core/nanoevents.ts';

export interface AuthSettings {
    path: string;
    key: string;
}

export interface PopupSettings {
    prefix: string;
    width: number;
    height: number;
}

/**
 * Response from getUserData()
 */
export interface UserDataResponse<UserData = any> {
    user: UserData;
}

/**
 * Response from authentication methods (login, register, anonymous, OAuth)
 */
export interface AuthResponse<UserData = any> {
    user: UserData;
    token: string;
}

/**
 * Response from sendPasswordResetEmail()
 */
export type ForgotPasswordResponse = boolean | unknown;

/**
 * @deprecated Use AuthResponse instead
 */
export type AuthData<UserData = any> = AuthResponse<UserData>;

export class Auth<UserData = any> {
    settings: AuthSettings = {
        path: "/auth",
        key: "colyseus-auth-token",
    };

    #_initialized = false;
    #_signInWindow: WindowProxy | null = null;
    #_events = createNanoEvents<{
        change: (response: AuthResponse) => void;
    }>();

    protected http: HTTP<any>;

    constructor(http: HTTP<any>) {
        this.http = http;
        getItem(this.settings.key, (token: string) => this.token = token);
    }

    public set token(token: string) {
        this.http.authToken = token;
    }

    public get token(): string | undefined {
        return this.http.authToken;
    }

    public onChange<U = UserData>(callback: (response: AuthResponse<U | null>) => void) {
        const unbindChange = this.#_events.on("change", callback);
        if (!this.#_initialized) {
            this.getUserData().then((userData) => {
                this.emitChange({ ...userData, token: this.token });

            }).catch((e) => {
                // user is not logged in, or service is down
                this.emitChange({ user: null, token: undefined });
            });
        }
        this.#_initialized = true;
        return unbindChange;
    }

    public async getUserData<U = UserData>(): Promise<UserDataResponse<U>> {
        if (this.token) {
            return (await this.http.get(`${this.settings.path}/userdata`)).data;
        } else {
            throw new Error("missing auth.token");
        }
    }

    public async registerWithEmailAndPassword<U = UserData>(
        email: string,
         password: string,
        options?: any
    ): Promise<AuthResponse<U>> {
        const data = (await this.http.post(`${this.settings.path}/register`, {
            body: { email, password, options, },
        })).data;

        this.emitChange(data);

        return data;
    }

    public async signInWithEmailAndPassword<U = UserData>(
        email: string,
        password: string
    ): Promise<AuthResponse<U>> {
        const data = (await this.http.post(`${this.settings.path}/login`, {
            body: { email, password, },
        })).data;

        this.emitChange(data);

        return data;
    }

    public async signInAnonymously<U = UserData>(options?: any): Promise<AuthResponse<U>> {
        const data = (await this.http.post(`${this.settings.path}/anonymous`, {
            body: { options, }
        })).data;

        this.emitChange(data);

        return data;
    }

    public async sendPasswordResetEmail(email: string): Promise<ForgotPasswordResponse> {
        return (await this.http.post(`${this.settings.path}/forgot-password`, {
            body: { email, }
        })).data;
    }

    public async signInWithProvider<U = UserData>(
        providerName: string,
        settings: Partial<PopupSettings> = {}
    ): Promise<AuthResponse<U>> {
        return new Promise((resolve, reject) => {
            const w = settings.width || 480;
            const h = settings.height || 768;

            // forward existing token for upgrading
            const upgradingToken = this.token ? `?token=${this.token}` : "";

            // Capitalize first letter of providerName
            const title = `Login with ${(providerName[0].toUpperCase() + providerName.substring(1))}`;
            const url = this.http['sdk']['getHttpEndpoint'](`${(settings.prefix || `${this.settings.path}/provider`)}/${providerName}${upgradingToken}`);

            const left = (screen.width / 2) - (w / 2);
            const top = (screen.height / 2) - (h / 2);

            this.#_signInWindow = window.open(url, title, 'toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=' + w + ', height=' + h + ', top=' + top + ', left=' + left);

            const onMessage = (event: MessageEvent) => {
                // TODO: it is a good idea to check if event.origin can be trusted!
                // if (event.origin.indexOf(window.location.hostname) === -1) { return; }

                // require 'user' and 'token' inside received data.
                if (event.data.user === undefined && event.data.token === undefined) { return; }

                clearInterval(rejectionChecker);
                this.#_signInWindow?.close();
                this.#_signInWindow = null;

                window.removeEventListener("message", onMessage);

                if (event.data.error !== undefined) {
                    reject(event.data.error);

                } else {
                    resolve(event.data);
                    this.emitChange(event.data);
                }
            }

            const rejectionChecker = setInterval(() => {
                if (!this.#_signInWindow || this.#_signInWindow.closed) {
                    this.#_signInWindow = null;
                    reject("cancelled");
                    window.removeEventListener("message", onMessage);
                }
            }, 200);

            window.addEventListener("message", onMessage);
        });
    }

    public async signOut(): Promise<void> {
        this.emitChange({ user: null, token: null });
    }

    private emitChange(authData: AuthResponse<UserData | null>) {
        if (authData.token !== undefined) {
            this.token = authData.token;

            if (authData.token === null) {
                removeItem(this.settings.key);

            } else {
                // store key in localStorage
                setItem(this.settings.key, authData.token);
            }
        }

        this.#_events.emit("change", authData);
    }

}
