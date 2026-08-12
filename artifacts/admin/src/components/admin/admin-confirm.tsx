import { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ConfirmRequest = {
  title?: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type ConfirmFn = (request: string | ConfirmRequest) => Promise<boolean>;

const AdminConfirmContext = createContext<ConfirmFn | null>(null);

export function AdminConfirmProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    resolver.current?.(confirmed);
    resolver.current = null;
    setRequest(null);
  }, []);

  const confirm = useCallback<ConfirmFn>((next) => {
    const normalized = typeof next === "string"
      ? { description: next, destructive: true }
      : next;
    return new Promise<boolean>((resolve) => {
      resolver.current?.(false);
      resolver.current = resolve;
      setRequest(normalized);
    });
  }, []);

  return (
    <AdminConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={Boolean(request)} onOpenChange={(open) => { if (!open) settle(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{request?.title ?? "Confirm this action"}</AlertDialogTitle>
            <AlertDialogDescription>{request?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>{request?.cancelLabel ?? "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              className={request?.destructive === false ? undefined : "!border-[#e2696d55] !bg-[#e2696d] !text-white hover:!bg-[#ed7c80]"}
              onClick={() => settle(true)}
            >
              {request?.confirmLabel ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminConfirmContext.Provider>
  );
}

export function useAdminConfirm() {
  const confirm = useContext(AdminConfirmContext);
  if (!confirm) throw new Error("useAdminConfirm must be used within AdminConfirmProvider");
  return confirm;
}
