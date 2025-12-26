import { debugAndPrintError } from './Debug.ts';
import { type Presence } from './presence/Presence.ts';
import { IpcProtocol } from './Protocol.ts';
import { generateId, REMOTE_ROOM_SHORT_TIMEOUT } from './utils/Utils.ts';

export async function requestFromIPC<T>(
  presence: Presence,
  publishToChannel: string,
  method: string | undefined,
  args: any[],
  rejectionTimeout: number = REMOTE_ROOM_SHORT_TIMEOUT,
): Promise<T> {
  return new Promise<T>(async (resolve, reject) => {
    let unsubscribeTimeout: NodeJS.Timeout;

    const requestId = generateId();
    const channel = `ipc:${requestId}`;

    const unsubscribe = () => {
      presence.unsubscribe(channel);
      clearTimeout(unsubscribeTimeout);
    };

    await presence.subscribe(channel, (message: [IpcProtocol, any]) => {
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

    } catch (e: any) {
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

/**
 * Wait for a room creation notification via presence publish/subscribe
 */
export function subscribeWithTimeout(
  presence: Presence,
  channel: string,
  timeout: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let timeoutHandle: NodeJS.Timeout;
    let resolved = false;

    const unsubscribe = () => {
      presence.unsubscribe(channel);
      clearTimeout(timeoutHandle);
    };

    presence.subscribe(channel, (roomId: string) => {
      if (resolved) return;
      resolved = true;
      unsubscribe();
      resolve(roomId);
    });

    timeoutHandle = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      unsubscribe();
      reject(new Error("timeout"));
    }, timeout);
  });
}