export interface ITransportEventMap {
    onopen?: ((ev: any) => any) | null;
    onmessage?: ((ev: any) => any) | null;
    onclose?: ((ev: any) => any) | null;
    onerror?: ((ev: any) => any) | null;
}

export interface ITransportConstructor {
    new (events: ITransportEventMap): ITransport;
}

export interface ITransport {
    isOpen: boolean;
    send(data: Buffer | Uint8Array): void;
    sendUnreliable(data: Buffer | Uint8Array): void;
    connect(url: string, options?: any): void;
    close(code?: number, reason?: string): void;
}
