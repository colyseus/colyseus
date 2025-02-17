/**
 * This serializer is a copy of SchemaSerializer,
 * but it writes debug information to a file.
 *
 * This script must be used
 */

import fs from 'fs';
import { Schema, dumpChanges, Iterator } from '@colyseus/schema';
import { SchemaSerializer } from './SchemaSerializer.js';
import { Client, ClientState  } from "../Transport.js";
import { Protocol} from '../Protocol.js';
import { debugPatch } from '../Debug.js';

/*
const SHARED_VIEW = {};

export class SchemaSerializerDebug<T> extends SchemaSerializer<T> {
  protected debugStream: fs.WriteStream;

  constructor(fileName: string = "schema-debug.txt") {
    super();

    try { fs.unlinkSync(fileName); } catch (e) {}
    this.debugStream = fs.createWriteStream(fileName, { flags: "a" });
  }

  public getFullState(client?: Client): Buffer {
    const buf = super.getFullState(client);
    this.debugStream.write(`state:${client.sessionId}:${Array.from(buf).slice(1).join(",")}\n`);
    return buf;
  }

  public applyPatches(clients: Client[]) {
    let numClients = clients.length;

    const debugChangesDeep = Schema.debugChangesDeep(this.encoder.state);

    if (
      numClients == 0 ||
      (
        this.encoder.root.changes.size === 0 &&
        (!this.hasFilters || this.encoder.root.filteredChanges.size === 0)
      )
    ) {
      // skip patching state if:
      // - no clients are connected
      // - no changes were made
      // - no "filtered changes" were made when using filters
      return false;
    }

    this.needFullEncode = true;

    // dump changes for patch debugging
    if (debugPatch.enabled) {
      (debugPatch as any).dumpChanges = dumpChanges(this.encoder.state);
    }

    // get patch bytes
    const it: Iterator = { offset: 1 };
    this.encoder.sharedBuffer[0] = Protocol.ROOM_STATE_PATCH;

    // encode changes once, for all clients
    const encodedChanges = this.encoder.encode(it);

    if (!this.hasFilters) {
      while (numClients--) {
        const client = clients[numClients];

        //
        // FIXME: avoid this check for each client
        //
        if (client.state !== ClientState.JOINED) {
          continue;
        }

        debugChangesDeep.split("\n").forEach((line) => {
          this.debugStream.write(`#${client.sessionId}:${line}\n`);
        });
        this.debugStream.write(`patch:${client.sessionId}:${Array.from(encodedChanges).slice(1).join(",")}\n`);

        client.raw(encodedChanges);
      }

    } else {
      // cache shared offset
      const sharedOffset = it.offset;

      // encode state multiple times, for each client
      while (numClients--) {
        const client = clients[numClients];

        //
        // FIXME: avoid this check for each client
        //
        if (client.state !== ClientState.JOINED) {
          continue;
        }

        const view = client.view || SHARED_VIEW;

        let encodedView = this.views.get(view);

        // allow to pass the same encoded view for multiple clients
        if (encodedView === undefined) {
          encodedView = (view === SHARED_VIEW)
            ? encodedChanges
            : this.encoder.encodeView(client.view, sharedOffset, it);
          this.views.set(view, encodedView);
        }

        debugChangesDeep.split("\n").forEach((line) => {
          this.debugStream.write(`#${client.sessionId}:${line}\n`);
        });
        this.debugStream.write(`patch:${client.sessionId}:${Array.from(encodedView).slice(1).join(",")}\n`);

        client.raw(encodedView);
      }

      // clear views
      this.views.clear();
    }

    // discard changes after sending
    this.encoder.discardChanges();

    // debug patches
    if (debugPatch.enabled) {
      debugPatch(
        '%d bytes sent to %d clients, %j',
        encodedChanges.length,
        clients.length,
        (debugPatch as any).dumpChanges,
      );
    }

    return true;
  }

  public handshake(): Buffer {
    const buf = super.handshake();
    this.debugStream.write(`handshake:${Array.from(buf).join(",")}\n`);
    return buf;
  }
}

*/