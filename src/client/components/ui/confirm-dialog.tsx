import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title?: string;
  description: string;
  confirmLabel?: string;
  variant?: 'danger' | 'primary';
  children?: React.ReactNode;
}

export const ConfirmDialog = ({
  open,
  onOpenChange,
  onConfirm,
  title = '確認',
  description,
  confirmLabel = '確認',
  variant = 'danger',
  children,
}: ConfirmDialogProps) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription className="whitespace-pre-line">
          {description}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {children && <div className="text-sm">{children}</div>}
      <AlertDialogFooter>
        <AlertDialogCancel>取消</AlertDialogCancel>
        <AlertDialogAction
          variant={variant === 'danger' ? 'destructive' : 'default'}
          onClick={onConfirm}
        >
          {confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
