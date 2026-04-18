"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { SupportTicket, ReplyTemplate } from "../lib/types"
import { FALLBACK_QUICK_REPLIES } from "../lib/constants"
import { applyTemplateVariables } from "../lib/ticket-utils"

export function useTicketDetail() {
  const queryClient = useQueryClient()

  // detail view
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState("")
  const [showQuickReplies, setShowQuickReplies] = useState(false)

  // internal note toggle
  const [isInternalNote, setIsInternalNote] = useState(false)

  // attachment
  const [attachedFile, setAttachedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // edits on detail
  const [editStatus, setEditStatus] = useState("")
  const [editPriority, setEditPriority] = useState("")
  const [editAssignee, setEditAssignee] = useState("Unassigned")

  const chatEndRef = useRef<HTMLDivElement>(null)

  /* ---- fetch reply templates ---- */
  const { data: replyTemplates = [] } = useQuery<ReplyTemplate[]>({
    queryKey: ["reply-templates"],
    queryFn: async () => {
      const res = await fetch("/api/reply-templates")
      if (!res.ok) throw new Error("Failed to fetch templates")
      return res.json()
    },
  })

  // Use DB templates if available, otherwise fall back to hardcoded ones
  const quickReplies = replyTemplates.length > 0
    ? replyTemplates.map((t) => ({ label: t.title, text: t.body }))
    : FALLBACK_QUICK_REPLIES

  /* ---- fetch single ticket detail ---- */
  const { data: ticketDetail, isLoading: detailLoading } =
    useQuery<SupportTicket>({
      queryKey: ["ticket-detail", selectedTicketId],
      queryFn: async () => {
        const res = await fetch(`/api/tickets/${selectedTicketId}`)
        if (!res.ok) throw new Error("Failed to fetch ticket")
        const json = await res.json()
        return { ...json.ticket, replies: json.replies || [] }
      },
      enabled: !!selectedTicketId,
    })

  // auto-scroll when replies load
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [ticketDetail?.replies?.length])

  /* ---- when ticket detail loads, seed edit fields ---- */
  const openTicket = useCallback((ticket: SupportTicket) => {
    setSelectedTicketId(ticket.id)
    setEditStatus(ticket.status)
    setEditPriority(ticket.priority)
    setEditAssignee(ticket.assigned_to || "Unassigned")
    setReplyText("")
    setShowQuickReplies(false)
    setAttachedFile(null)
    setIsInternalNote(false)
  }, [])

  /* ---- update ticket mutation ---- */
  const updateMutation = useMutation({
    mutationFn: async ({
      status,
      priority,
      assigned_to,
    }: {
      status: string
      priority: string
      assigned_to?: string
    }) => {
      const res = await fetch(`/api/tickets/${selectedTicketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, priority, assigned_to }),
      })
      if (!res.ok) throw new Error("Update failed")
      return res.json()
    },
    onSuccess: () => {
      toast.success("Ticket updated")
      queryClient.invalidateQueries({ queryKey: ["tickets-all"] })
      queryClient.invalidateQueries({
        queryKey: ["ticket-detail", selectedTicketId],
      })
    },
    onError: () => toast.error("Failed to update ticket"),
  })

  /* ---- reply mutation (supports FormData for attachments) ---- */
  const replyMutation = useMutation({
    mutationFn: async ({
      message,
      file,
      internal,
    }: {
      message: string
      file: File | null
      internal: boolean
    }) => {
      if (file) {
        const fd = new FormData()
        fd.append("message", message)
        fd.append("author_name", "AMASI Admin")
        fd.append("attachment", file)
        if (internal) fd.append("is_internal", "true")
        const res = await fetch(`/api/tickets/${selectedTicketId}/reply`, {
          method: "POST",
          body: fd,
        })
        if (!res.ok) throw new Error("Reply failed")
        return res.json()
      }
      const res = await fetch(`/api/tickets/${selectedTicketId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          is_admin: true,
          is_internal: internal,
          author_name: "AMASI Admin",
        }),
      })
      if (!res.ok) throw new Error("Reply failed")
      return res.json()
    },
    onSuccess: () => {
      toast.success(isInternalNote ? "Internal note added" : "Reply sent")
      setReplyText("")
      setShowQuickReplies(false)
      setAttachedFile(null)
      setIsInternalNote(false)
      queryClient.invalidateQueries({
        queryKey: ["ticket-detail", selectedTicketId],
      })
      queryClient.invalidateQueries({ queryKey: ["tickets-all"] })
    },
    onError: () => toast.error(isInternalNote ? "Failed to add note" : "Failed to send reply"),
  })

  const handleSaveChanges = () => {
    updateMutation.mutate({ status: editStatus, priority: editPriority, assigned_to: editAssignee })
  }

  const handleSendReply = () => {
    if (!replyText.trim() && !attachedFile) return
    replyMutation.mutate({ message: replyText.trim(), file: attachedFile, internal: isInternalNote })
  }

  const handleToggleClose = () => {
    const newStatus = ticketDetail?.status === "closed" ? "open" : "closed"
    updateMutation.mutate({ status: newStatus, priority: editPriority })
    setEditStatus(newStatus)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error("File too large. Max 10MB.")
        return
      }
      setAttachedFile(file)
    }
  }

  const handleQuickReplySelect = (text: string) => {
    setReplyText(applyTemplateVariables(text, ticketDetail ?? null))
    setShowQuickReplies(false)
  }

  return {
    selectedTicketId,
    ticketDetail,
    detailLoading,
    replyText,
    setReplyText,
    showQuickReplies,
    setShowQuickReplies,
    isInternalNote,
    setIsInternalNote,
    attachedFile,
    setAttachedFile,
    fileInputRef,
    chatEndRef,
    editStatus,
    setEditStatus,
    editPriority,
    setEditPriority,
    editAssignee,
    setEditAssignee,
    quickReplies,
    openTicket,
    updateMutation,
    replyMutation,
    handleSaveChanges,
    handleSendReply,
    handleToggleClose,
    handleFileSelect,
    handleQuickReplySelect,
    queryClient,
  }
}
