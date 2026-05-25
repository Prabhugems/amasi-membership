"use client"

// Small reusable confirmation dialog. Walking skeleton for admin recovery
// actions (Phase 1: unexpire; Phase 2/3 will reuse). The page-level dialogs
// for delete/refund/bulk-reminder are intentionally NOT migrated — each
// carries unique body content; refactoring them isn't in scope here.
//
// API: title + description for simple text confirmations. Pass `children`
// for richer bodies (Phase 2's orphan-payment confirm will use this slot).
import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children?: ReactNode
  confirmLabel: string
  onConfirm: () => void
  isPending?: boolean
  variant?: "default" | "destructive"
  cancelLabel?: string
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  onConfirm,
  isPending = false,
  variant = "default",
  cancelLabel = "Cancel",
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle
            className={
              variant === "destructive"
                ? "text-red-600 dark:text-red-400"
                : undefined
            }
          >
            {title}
          </DialogTitle>
        </DialogHeader>
        {(description || children) && (
          <div className="space-y-3 text-sm text-muted-foreground">
            {description && <p>{description}</p>}
            {children}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            variant={variant === "destructive" ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Working…
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
