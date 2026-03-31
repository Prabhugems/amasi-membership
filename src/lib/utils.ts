import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return "N/A"
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "N/A"
  return phone.replace(/(\d{5})(\d{5})/, "$1 $2")
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export function getStatusColor(status: string): string {
  switch (status) {
    case "Membership Number Allotted":
      return "text-success"
    case "Pending":
    case "Document Verification Pending":
      return "text-warning"
    case "Rejected":
      return "text-destructive"
    default:
      return "text-muted-foreground"
  }
}
