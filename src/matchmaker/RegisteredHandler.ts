import { EventEmitter } from 'events';

export class RegisteredHandler extends EventEmitter {
  klass: any;
  options: any;

  constructor (klass: any, options: any) {
    super();

    this.klass = klass;
    this.options = options;
  }
}