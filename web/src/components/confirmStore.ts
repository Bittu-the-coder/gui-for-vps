import { create } from 'zustand';

/** Ask a yes/no question with a proper dialog (instead of the browser's native `confirm`). */
export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
}
interface Request extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}
export const useConfirm = create<{ request: Request | null }>(() => ({ request: null }));

/** Resolves true if the user confirms, false if they cancel or dismiss. Only one is open at a time. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirm.setState((s) => {
      s.request?.resolve(false); // a newer question replaces an unanswered one
      return { request: { ...opts, resolve } };
    });
  });
}

export function answerConfirm(ok: boolean): void {
  const r = useConfirm.getState().request;
  if (!r) return;
  useConfirm.setState({ request: null });
  r.resolve(ok);
}
