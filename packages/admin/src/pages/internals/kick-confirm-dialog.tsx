/**
 * Shared confirm-kick dialog used by the room inspector (kick a client
 * from inside a room view) and the user show page's Active sessions
 * tab (kick a session out of whatever room it's in).
 *
 * Holds a local `reason` field so the field clears between opens and
 * doesn't cross-pollinate when multiple kick triggers sit in the same
 * table. The reason is forwarded to the backend, which passes it as
 * the close-frame reason and records it in the audit payload.
 */
import * as React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface KickConfirmDialogProps {
  title: React.ReactNode;
  description: React.ReactNode;
  /** Stable key used to namespace the reason input id and the trigger
   *  testid — sessionId works for both call sites today. */
  idKey: string;
  triggerTestId?: string;
  triggerAriaLabel?: string;
  busy?: boolean;
  onConfirm: (reason: string | undefined) => void;
}

export function KickConfirmDialog({
  title, description, idKey,
  triggerTestId, triggerAriaLabel = 'Kick',
  busy = false, onConfirm,
}: KickConfirmDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) { setReason(''); }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost" size="icon"
          disabled={busy}
          data-testid={triggerTestId}
          aria-label={triggerAriaLabel}
        >
          <X className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor={`kick-reason-${idKey}`} className="text-xs">
            Reason (optional)
          </Label>
          <Input
            id={`kick-reason-${idKey}`}
            value={reason}
            placeholder="e.g. abusive chat"
            maxLength={120}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onConfirm(reason.trim() || undefined)}
            data-testid={triggerTestId ? `${triggerTestId}-confirm` : undefined}
          >
            Kick
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
