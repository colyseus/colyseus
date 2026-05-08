import { toast } from 'sonner';
import type { NotificationProvider } from '@refinedev/core';

/**
 * Refine notification provider backed by `sonner`. Refine's hooks
 * (useNotification, useUpdate's onError, etc.) call `open` / `close` to
 * surface success / error toasts; this maps them to sonner's API.
 *
 * Drop-in replacement for `@refinedev/antd`'s useNotificationProvider —
 * we no longer need AntD's `notification` instance running.
 */
export const notificationProvider: NotificationProvider = {
  open: ({ message, description, type, key }) => {
    const opts = { id: key, description };
    if (type === 'success') { toast.success(message, opts); }
    else if (type === 'error') { toast.error(message, opts); }
    else { toast(message, opts); }
  },
  close: (key) => { toast.dismiss(key); },
};
