export function serialize(serializer: FunctionConstructor & any) {
  return (constructor: Function) => {
    constructor.prototype._getSerializer = () => new serializer();
  };
}

export interface Serializer<T> {
  reset(data: any): void;
  hasChanged(newState: any): boolean;
  getData(): any;
  getPatches(): any;
}
