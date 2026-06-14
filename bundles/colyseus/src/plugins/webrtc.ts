/**
 * WebRTC signaling plugin — wires the four standard signaling messages
 * (peers list + offer/answer/ICE relay) onto a room, plus a `peer-left`
 * broadcast when a connected peer disconnects.
 *
 * Ports the standalone `@colyseus/webrtc` package as a `RoomPlugin` so
 * the plumbing is automatic — no `messages = { ...signaling }` spread
 * and no manual `onPeerDisconnected(room, client)` call from `onLeave`.
 *
 * Usage:
 *
 *   import { WebRTCPlugin } from 'colyseus/plugins/webrtc';
 *
 *   class GameRoom extends Room {
 *     plugins = definePlugins({
 *       webrtc: new WebRTCPlugin(),
 *     });
 *   }
 *
 * The plugin tracks which clients have explicitly opted into the mesh
 * (sent `webrtc:join`) so `webrtc:peer-left` is only emitted for them —
 * spectators and other non-WebRTC clients in the same room don't show
 * up in peer events.
 *
 * @see https://github.com/colyseus/webrtc for the original standalone
 *      package this plugin is derived from.
 */
import { RoomPlugin, type Client } from '@colyseus/core';

/** WebRTC offer payload (peer ↔ peer). */
export interface SignalingOffer {
  targetId: string;
  sdp: any; // RTCSessionDescriptionInit — browser type, intentionally `any` server-side
}

/** WebRTC answer payload (peer ↔ peer). */
export interface SignalingAnswer {
  targetId: string;
  sdp: any;
}

/** WebRTC ICE candidate payload (peer ↔ peer). */
export interface SignalingIceCandidate {
  targetId: string;
  candidate: any; // RTCIceCandidateInit — browser type
}

export class WebRTCPlugin extends RoomPlugin {
  readonly pluginName = 'webrtc' as const;

  /**
   * Session IDs that have explicitly opted into the mesh via
   * `webrtc:join`. Used by `onLeave` so we only emit `webrtc:peer-left`
   * for clients the rest of the mesh actually knew about.
   */
  private peers = new Set<string>();

  protected messages = {
    /**
     * Client → server. Opt this client into the mesh: reply with the
     * current peer list and notify the other peers that a new one has
     * joined. Idempotent — re-joining sends the (possibly extended) list
     * again but doesn't double-broadcast.
     */
    'webrtc:join': (client: Client) => {
      if (this.peers.has(client.sessionId)) {
        client.send('webrtc:peers', [...this.peers].filter((id) => id !== client.sessionId));
        return;
      }
      const existingPeers = [...this.peers];
      this.peers.add(client.sessionId);
      client.send('webrtc:peers', existingPeers);
      this.room.broadcast('webrtc:peer-joined', client.sessionId, { except: client });
    },

    /** Client → server → target client. Relays an SDP offer. */
    'webrtc:offer': (client: Client, message: SignalingOffer) => {
      const target = this.room.clients.get(message.targetId);
      target?.send('webrtc:offer', { peerId: client.sessionId, sdp: message.sdp });
    },

    /** Client → server → target client. Relays an SDP answer. */
    'webrtc:answer': (client: Client, message: SignalingAnswer) => {
      const target = this.room.clients.get(message.targetId);
      target?.send('webrtc:answer', { peerId: client.sessionId, sdp: message.sdp });
    },

    /** Client → server → target client. Relays an ICE candidate. */
    'webrtc:ice-candidate': (client: Client, message: SignalingIceCandidate) => {
      const target = this.room.clients.get(message.targetId);
      target?.send('webrtc:ice-candidate', { peerId: client.sessionId, candidate: message.candidate });
    },
  };

  protected onLeave(client: Client) {
    if (!this.peers.has(client.sessionId)) { return; }
    this.peers.delete(client.sessionId);
    this.room.broadcast('webrtc:peer-left', client.sessionId, { except: client });
  }
}
