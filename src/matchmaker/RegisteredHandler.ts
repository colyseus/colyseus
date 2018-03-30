import { EventEmitter } from 'events';
import { RoomConstructor } from './../Room';

export class RegisteredHandler extends EventEmitter {
  public klass: RoomConstructor;
  public options: any;

  constructor(klass: RoomConstructor, options: any) {
    super();

    this.klass = klass;
    this.options = options;
  }
}
