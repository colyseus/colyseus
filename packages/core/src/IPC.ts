import { debugAndPrintError } from './Debug.js';
import { Presence } from './presence/Presence.js';
import { IpcProtocol } from './Protocol.js';
import { generateId, REMOTE_ROOM_SHORT_TIMEOUT } from './utils/Utils.js';

export async function requestFromIPC<T>(
  presence: Presence,
  publishToChannel: string,
  method: string,
  args: any[],
  rejectionTimeout: number = REMOTE_ROOM_SHORT_TIMEOUT,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let unsubscribeTimeout: NodeJS.Timeout;

    const requestId = generateId();
    const channel = `ipc:${requestId}`;

    const unsubscribe = () => {
      presence.unsubscribe(channel);
      clearTimeout(unsubscribeTimeout);
    };

    presence.subscribe(channel, (message) => {
      const [code, data] = message;
      if (code === IpcProtocol.SUCCESS) {
        resolve(data);

      } else if (code === IpcProtocol.ERROR) {
        let error: any = data;

        // parse error message + code
        try { error = JSON.parse(data) } catch (e) {}

        // turn string message into Error instance
        if (typeof(error) === "string") {
          error = new Error(error);
        }

        reject(error);
      }
      unsubscribe();
    });

    presence.publish(publishToChannel, [method, requestId, args]);

    unsubscribeTimeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("ipc_timeout"));
    }, rejectionTimeout);
  });
}

export async function subscribeIPC(
  presence: Presence,
  processId: string,
  channel: string,
  replyCallback: (method: string, args: any[]) => any,
) {
  await presence.subscribe(channel, (message) => {
    const [method, requestId, args] = message;

    const reply = (code, data) => {
      presence.publish(`ipc:${requestId}`, [code, data]);
    };

    // reply with method result
    let response: any;
    try {
      response = replyCallback(method, args);

    } catch (e) {
      debugAndPrintError(e);
      const error = (typeof(e.code) !== "undefined")
        ? { code: e.code, message: e.message }
        : e.message;
      return reply(IpcProtocol.ERROR, JSON.stringify(error));
    }

    if (!(response instanceof Promise)) {
      return reply(IpcProtocol.SUCCESS, response);
    }

    response.
      then((result) => reply(IpcProtocol.SUCCESS, result)).
      catch((e) => {
        // user might have called `reject()` without arguments.
        const err = e && e.message || e;
        reply(IpcProtocol.ERROR, err);
      });
  });
}
