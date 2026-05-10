import { useState } from 'react';
import { useDelete, useNotification } from '@refinedev/core';
import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export function ActionButton({ resource, action, rowId, onComplete }: {
  resource: string;
  action: { name: string; label: string; perRow: boolean; confirm?: { title?: string; description?: string } };
  rowId?: string;
  onComplete?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { open } = useNotification();
  const run = async () => {
    setBusy(true);
    try {
      const headers: HeadersInit = { 'content-type': 'application/json' };
      const userId = localStorage.getItem('colyseus-admin-user-id') ?? '';
      if (userId) { (headers as any)['X-User-Id'] = userId; }
      const res = await fetch(`/admin-api/${resource}/_action/${action.name}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(rowId ? { id: rowId } : {}),
      });
      const text = await res.text();
      if (!res.ok) {
        open?.({ type: 'error', message: `${action.label} failed`, description: text });
      } else {
        open?.({ type: 'success', message: `${action.label} succeeded` });
        onComplete?.();
      }
    } finally { setBusy(false); }
  };

  const trigger = (
    <Button
      size="sm"
      variant="outline"
      data-testid={`action-${action.name}-${rowId ?? 'global'}`}
      disabled={busy}
      onClick={action.confirm ? undefined : run}
    >
      {busy && <Loader2 className="animate-spin" />}
      {action.label}
    </Button>
  );

  if (!action.confirm) { return trigger; }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{action.confirm.title ?? `Run "${action.label}"?`}</AlertDialogTitle>
          {action.confirm.description && (
            <AlertDialogDescription>{action.confirm.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={run}>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteRowButton({ resource, id, onDeleted }: {
  resource: string; id: string; onDeleted: () => void;
}) {
  const { mutate: deleteRow } = useDelete();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="delete" data-testid={`delete-${id}`}>
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete row?</AlertDialogTitle>
          <AlertDialogDescription>This action can't be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => deleteRow(
              { resource, id },
              { onSuccess: onDeleted },
            )}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
