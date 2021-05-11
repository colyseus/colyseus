import { debugAndPrintError } from './Debug';
import { Presence } from './presence/Presence';
import { IpcProtocol } from './Protocol';
import { generateId, REMOTE_ROOM_SHORT_TIMEOUT } from './Utils';

export async function requestFromIPC<T>(
  presence: Presence,
  publishToChannel: string,
  method: string,
  args: any[],
  rejectionTimeout: number = REMOTE_ROOM_SHORT_TIMEOUT,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let unsubscribeTimeout: NodeJS.Timer;

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
        reject(data);
      }
      unsubscribe();
    });

    presence.publish(publishToChannel, [method, requestId, args]);

    unsubscribeTimeout = setTimeout(() => {
      unsubscribe();
      reject(`IPC timed out. method: ${method}, args: ${JSON.stringify(args)}`);
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
      return reply(IpcProtocol.ERROR, e.message || e);
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
