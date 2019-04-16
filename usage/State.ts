import { Schema, type } from '@colyseus/schema';

export default class State extends Schema {
  @type('string')
  public lastMessage: string = '';
}
