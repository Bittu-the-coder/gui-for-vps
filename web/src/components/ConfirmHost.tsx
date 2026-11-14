import { answerConfirm, useConfirm } from './confirmStore';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

/** Mounted once (in the Desktop): shows whatever `confirmDialog()` asked. */
export function ConfirmHost() {
  const request = useConfirm((s) => s.request);
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && answerConfirm(false)}>
      {request && (
        <DialogContent role="alertdialog" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{request.title}</DialogTitle>
            <DialogDescription className="whitespace-pre-line">{request.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {/* Cancel has the focus, so a stray Enter never confirms a destructive question. */}
            <Button autoFocus variant="secondary" onClick={() => answerConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant={request.danger ? 'destructive' : 'default'}
              onClick={() => answerConfirm(true)}
            >
              {request.confirmLabel ?? 'OK'}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
