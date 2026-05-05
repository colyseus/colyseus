import { Protocol } from '@colyseus/shared-types';
import { type Iterator, Encoder, dumpChanges, Reflection, Schema, StateView } from '@colyseus/schema';
import { debugPatch } from '../Debug.ts';
import { type Client, ClientState } from '../Transport.ts';
import type { Serializer } from './Serializer.ts';

const SHARED_VIEW = {};
const PROTOCOL_PREFIX_LEN = 1;
const SWITCH_TO_ROOT = new Uint8Array([255, 0]);
const EMPTY_BYTES = new Uint8Array();

type ViewChangeSet = Record<string, number>;
type ViewChanges = Map<number, ViewChangeSet>;
type ViewWithMutableChanges = StateView & {
  changes: ViewChanges;
};
type ChangeTreeList = {
  next?: unknown;
  tail?: unknown;
};
type EncoderRootInternals = {
  filteredChanges: ChangeTreeList;
  changeTrees: Record<number, { ref?: unknown } | undefined>;
};
type SchemaMetadataEntry = {
  type?: unknown;
};

function encoderRoot<T extends Schema>(encoder: Encoder<T>): EncoderRootInternals {
  return (encoder as unknown as { root: EncoderRootInternals }).root;
}

function createEmptyChangeTreeList(): ChangeTreeList {
  return { next: undefined, tail: undefined };
}

function getSchemaMetadata(ref: unknown): Record<number, SchemaMetadataEntry> | undefined {
  if ((typeof ref !== 'object' && typeof ref !== 'function') || ref === null) {
    return undefined;
  }

  return (ref as { constructor?: { [Symbol.metadata]?: Record<number, SchemaMetadataEntry> } })
    .constructor?.[Symbol.metadata];
}

function isStructuralViewChange<T extends Schema>(
  encoder: Encoder<T>,
  refId: number,
  fieldIndex: string,
): boolean {
  const changeTree = encoderRoot(encoder).changeTrees[refId];
  const metadata = getSchemaMetadata(changeTree?.ref);

  if (metadata === undefined) {
    return true;
  }

  const field = metadata[Number(fieldIndex)];
  return field !== undefined && typeof field.type !== 'string';
}

function splitViewChangesForIntroductions<T extends Schema>(
  encoder: Encoder<T>,
  view: ViewWithMutableChanges,
): { introductions: ViewChanges; remaining: ViewChanges } {
  const introductions: ViewChanges = new Map();
  const remaining: ViewChanges = new Map();

  for (const [refId, changes] of view.changes) {
    for (const fieldIndex of Object.keys(changes)) {
      const operation = changes[fieldIndex];
      if (operation === undefined) {
        continue;
      }

      const target = isStructuralViewChange(encoder, refId, fieldIndex)
        ? introductions
        : remaining;
      const targetChanges = target.get(refId) ?? {};
      targetChanges[fieldIndex] = operation;
      target.set(refId, targetChanges);
    }
  }

  return { introductions, remaining };
}

function encodeViewIntroductions<T extends Schema>(
  encoder: Encoder<T>,
  view: ViewWithMutableChanges,
  sharedOffset: number,
  it: Iterator,
  bytes: Uint8Array,
): Uint8Array {
  const root = encoderRoot(encoder);
  const filteredChanges = root.filteredChanges;
  const { introductions, remaining } = splitViewChangesForIntroductions(encoder, view);

  root.filteredChanges = createEmptyChangeTreeList();
  view.changes = introductions;

  try {
    return encoder.encodeView(view, sharedOffset, it, bytes);
  } finally {
    root.filteredChanges = filteredChanges;
    view.changes = remaining;
  }
}

function encodeViewChangesOnly<T extends Schema>(
  encoder: Encoder<T>,
  view: ViewWithMutableChanges,
  sharedOffset: number,
  it: Iterator,
  bytes: Uint8Array,
): Uint8Array {
  const root = encoderRoot(encoder);
  const filteredChanges = root.filteredChanges;

  root.filteredChanges = createEmptyChangeTreeList();

  try {
    return encoder.encodeView(view, sharedOffset, it, bytes);
  } finally {
    root.filteredChanges = filteredChanges;
  }
}

function concatViewState(
  viewIntroductionsState: Uint8Array,
  baseState: Uint8Array,
  sharedOffset: number,
  remainingViewState: Uint8Array = EMPTY_BYTES,
): Uint8Array {
  const protocolByte = baseState.subarray(0, PROTOCOL_PREFIX_LEN);
  const baseBody = baseState.subarray(PROTOCOL_PREFIX_LEN, sharedOffset);
  const viewIntroductions = viewIntroductionsState.subarray(sharedOffset);
  const remainingViewChanges = remainingViewState.subarray(sharedOffset);
  const baseTail = baseState.subarray(sharedOffset);
  const switchToRoot = baseBody.length > 0 ? SWITCH_TO_ROOT : EMPTY_BYTES;
  const out = new Uint8Array(
    protocolByte.length +
      viewIntroductions.length +
      switchToRoot.length +
      baseBody.length +
      remainingViewChanges.length +
      baseTail.length,
  );

  let offset = 0;
  out.set(protocolByte, offset);
  offset += protocolByte.length;
  out.set(viewIntroductions, offset);
  offset += viewIntroductions.length;
  out.set(switchToRoot, offset);
  offset += switchToRoot.length;
  out.set(baseBody, offset);
  offset += baseBody.length;
  out.set(remainingViewChanges, offset);
  offset += remainingViewChanges.length;
  out.set(baseTail, offset);

  return out;
}

function discardInvalidViewChanges<T extends Schema>(
  encoder: Encoder<T>,
  view: ViewWithMutableChanges,
): void {
  const root = encoderRoot(encoder);

  for (const [refId, changes] of view.changes) {
    const changeTree = root.changeTrees[refId];

    if (changeTree === undefined) {
      view.changes.delete(refId);
      continue;
    }

    const metadata = getSchemaMetadata(changeTree.ref);
    if (metadata === undefined) {
      continue;
    }

    for (const fieldIndex of Object.keys(changes)) {
      if (metadata[Number(fieldIndex)] === undefined) {
        delete changes[fieldIndex];
      }
    }

    if (Object.keys(changes).length === 0) {
      view.changes.delete(refId);
    }
  }
}

export class SchemaSerializer<T extends Schema> implements Serializer<T> {
  public id = 'schema';

  protected encoder: Encoder<T>;
  protected hasFilters: boolean = false;

  protected handshakeCache: Uint8Array;

  // flag to avoid re-encoding full state if no changes were made
  protected needFullEncode: boolean = true;

  // TODO: make this optional. allocating a new buffer for each room may not be always necessary.
  protected fullEncodeBuffer: Uint8Array = new Uint8Array(Encoder.BUFFER_SIZE);
  protected fullEncodeCache: Uint8Array;
  protected sharedOffsetCache: Iterator = { offset: 0 };

  protected encodedViews: Map<StateView | typeof SHARED_VIEW, Uint8Array>;

  public reset(newState: T & Schema) {
    this.encoder = new Encoder(newState);
    this.hasFilters = this.encoder.context.hasFilters;

    // cache ROOM_STATE byte as part of the encoded buffer
    this.fullEncodeBuffer[0] = Protocol.ROOM_STATE;

    if (this.hasFilters) {
      this.encodedViews = new Map();
    }
  }

  public getFullState(client?: Client) {
    if (this.needFullEncode || this.encoder.root.changes.next !== undefined) {
      this.sharedOffsetCache = { offset: PROTOCOL_PREFIX_LEN };
      this.fullEncodeCache = this.encoder.encodeAll(this.sharedOffsetCache, this.fullEncodeBuffer);
      if (this.fullEncodeCache.buffer !== this.fullEncodeBuffer.buffer) {
        this.fullEncodeBuffer = new Uint8Array(this.fullEncodeCache.buffer);
      }
      this.needFullEncode = false;
    }

    if (this.hasFilters && client?.view) {
      const view = client.view as ViewWithMutableChanges;
      const sharedOffset = this.sharedOffsetCache.offset;
      const fullViewBytes = this.encoder.encodeAllView(
        view,
        sharedOffset,
        { ...this.sharedOffsetCache },
        this.fullEncodeBuffer,
      );

      // Encode pending view introductions before the cached encodeAll baseline
      // so late filtered snapshots do not reference refs before introducing them.
      // See: https://github.com/colyseus/colyseus/issues/935
      if (view.changes.size === 0) {
        return fullViewBytes;
      }

      discardInvalidViewChanges(this.encoder, view);
      if (view.changes.size === 0) {
        return fullViewBytes;
      }

      const viewIntroductionsBytes = encodeViewIntroductions(
        this.encoder,
        view,
        sharedOffset,
        { ...this.sharedOffsetCache },
        this.fullEncodeBuffer,
      );
      const remainingViewBytes = encodeViewChangesOnly(
        this.encoder,
        view,
        sharedOffset,
        { ...this.sharedOffsetCache },
        this.fullEncodeBuffer,
      );

      return concatViewState(
        viewIntroductionsBytes,
        fullViewBytes,
        sharedOffset,
        remainingViewBytes,
      );
    } else {
      return this.fullEncodeCache;
    }
  }

  public applyPatches(clients: Client[]) {
    let numClients = clients.length;

    if (numClients === 0) {
      if (this.encoder.hasChanges) {
        // if there are changes but no clients, we need to encode full state on next patch
        this.needFullEncode = true;
      }
      // skip patching and clear changes
      this.encoder.discardChanges();
      return false;
    }

    if (!this.encoder.hasChanges) {
      // check if views have changes (manual add() or remove() items)
      if (this.hasFilters) {
        //
        // FIXME: refactor this to avoid duplicating code.
        //
        // it's probably better to have 2 different 'applyPatches' methods.
        // (one for handling state with filters, and another for handling state without filters)
        //
        const clientsWithViewChange = clients.filter((client) => {
          return client.state === ClientState.JOINED && client.view?.changes.size > 0;
        });

        if (clientsWithViewChange.length > 0) {
          const it: Iterator = { offset: PROTOCOL_PREFIX_LEN };

          const sharedOffset = it.offset;
          this.encoder.sharedBuffer[0] = Protocol.ROOM_STATE_PATCH;

          clientsWithViewChange.forEach((client) => {
            const view = client.view as ViewWithMutableChanges;
            discardInvalidViewChanges(this.encoder, view);
            if (view.changes.size > 0) {
              client.raw(this.encoder.encodeView(view, sharedOffset, it));
            }
          });
        }
      }

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
    const it: Iterator = { offset: PROTOCOL_PREFIX_LEN };
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

        let encodedView = this.encodedViews.get(view);

        // allow to pass the same encoded view for multiple clients
        if (encodedView === undefined) {
          if (view !== SHARED_VIEW) {
            discardInvalidViewChanges(this.encoder, client.view as ViewWithMutableChanges);
          }

          if (view !== SHARED_VIEW && client.view!.changes.size > 0) {
            const typedView = client.view as ViewWithMutableChanges;
            const viewIntroductionsBytes = encodeViewIntroductions(
              this.encoder,
              typedView,
              sharedOffset,
              { ...it },
              this.encoder.sharedBuffer,
            );
            const remainingViewBytes = this.encoder.encodeView(
              typedView,
              sharedOffset,
              { ...it },
              this.encoder.sharedBuffer,
            );

            encodedView = concatViewState(
              viewIntroductionsBytes,
              encodedChanges,
              sharedOffset,
              remainingViewBytes,
            );
          } else {
            encodedView =
              view === SHARED_VIEW
                ? encodedChanges
                : this.encoder.encodeView(client.view, sharedOffset, it);
          }

          this.encodedViews.set(view, encodedView);
        }

        client.raw(encodedView);
      }

      // clear views
      this.encodedViews.clear();
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

  public handshake() {
    /**
     * Cache handshake to avoid encoding it for each client joining
     */
    if (!this.handshakeCache) {
      //
      // TODO: re-use handshake buffer for all rooms of same type (?)
      //
      this.handshakeCache = this.encoder.state && Reflection.encode(this.encoder);
    }

    return this.handshakeCache;
  }
}
