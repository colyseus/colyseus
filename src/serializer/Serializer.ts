export function serialize(serializer: new () => Serializer<any>) {
  return (constructor: Function) => {
    constructor.prototype._getSerializer = () => new serializer();
  };
}

export interface Serializer<T> {
  id: string;
  reset(data: any): void;
  hasChanged(newState: any): boolean;
  getData(): any;
  getPatches(): any;
  handshake?(): number[];
}
