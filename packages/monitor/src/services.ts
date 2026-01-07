const ENDPOINT = (
  process.env.GAME_SERVER_URL ||
  `${window.location.protocol}//${window.location.host}${window.location.pathname}`
).replace(/\/$/, ""); // remove trailing slash

export function fetchRoomList () {
    return fetch(`${ENDPOINT}/api`)
      .then(res => res.json());
}

export function fetchRoomData (roomId: string) {
    return fetch(`${ENDPOINT}/api/room?roomId=${roomId}`)
      .then(res => res.json());
}

export function remoteRoomCall(roomId: string, method: string, ...args: any[]) {
    const query = new URLSearchParams();
    query.set('roomId', roomId);
    query.set('method', method);
    query.set('args', JSON.stringify(args));
    return fetch(`${ENDPOINT}/api/room/call?${query.toString()}`)
      .then(res => res.json());
}