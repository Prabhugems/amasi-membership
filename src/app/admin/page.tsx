"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Shield, ShieldCheck, Eye, Plus, Trash2, UserCheck, UserX, Loader2, Activity,
} from "lucide-react"
import { toast } from "sonner"
import { AdminActivityPanel, type AdminActivityAdmin } from "@/components/admin/admin-activity-panel"

interface AdminUser {
  id: string
  email: string
  name: string
  role: string
  permissions: string[]
  is_active: boolean
  last_login: string | null
  created_at: string
}

const ROLE_LABELS: Record<string, { label: string; color: string; description: string }> = {
  super_admin: {
    label: "Super Admin",
    color: "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-400/30",
    description: "Full access to all features including admin management",
  },
  admin: {
    label: "Admin",
    color: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-400/30",
    description: "Can approve/reject applications and edit members",
  },
  reviewer: {
    label: "Reviewer",
    color: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    description: "View-only access, cannot approve or edit",
  },
}

const ROLE_ICONS: Record<string, typeof Shield> = {
  super_admin: ShieldCheck,
  admin: Shield,
  reviewer: Eye,
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [formName, setFormName] = useState("")
  const [formEmail, setFormEmail] = useState("")
  const [formPassword, setFormPassword] = useState("")
  const [formRole, setFormRole] = useState("reviewer")

  // Activity panel state
  const [activityAdmin, setActivityAdmin] = useState<AdminActivityAdmin | null>(null)

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users")
      if (res.status === 403) {
        setAuthorized(false)
        return
      }
      const data = await res.json()
      if (data.status) {
        setUsers(data.data)
      }
    } catch {
      toast.error("Failed to load admin users")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formName || !formEmail || !formPassword) {
      toast.error("All fields are required")
      return
    }
    if (formPassword.length < 6) {
      toast.error("Password must be at least 6 characters")
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName,
          email: formEmail,
          password: formPassword,
          role: formRole,
        }),
      })
      const data = await res.json()
      if (res.ok && data.status) {
        toast.success("Admin user created")
        setFormName("")
        setFormEmail("")
        setFormPassword("")
        setFormRole("reviewer")
        setShowForm(false)
        fetchUsers()
      } else {
        toast.error(data.error || "Failed to create admin user")
      }
    } catch {
      toast.error("Failed to create admin user")
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggleActive = async (user: AdminUser) => {
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, is_active: !user.is_active }),
      })
      const data = await res.json()
      if (res.ok && data.status) {
        toast.success(user.is_active ? "Admin deactivated" : "Admin activated")
        fetchUsers()
      } else {
        toast.error(data.error || "Failed to update")
      }
    } catch {
      toast.error("Failed to update admin user")
    }
  }

  const handleDelete = async (user: AdminUser) => {
    if (!confirm(`Delete admin user "${user.name}" (${user.email})? This cannot be undone.`)) return

    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id }),
      })
      const data = await res.json()
      if (res.ok && data.status) {
        toast.success("Admin user deleted")
        fetchUsers()
      } else {
        toast.error(data.error || "Failed to delete")
      }
    } catch {
      toast.error("Failed to delete admin user")
    }
  }

  const handleChangeRole = async (user: AdminUser, newRole: string) => {
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, role: newRole }),
      })
      const data = await res.json()
      if (res.ok && data.status) {
        toast.success(`Role changed to ${ROLE_LABELS[newRole]?.label || newRole}`)
        fetchUsers()
      } else {
        toast.error(data.error || "Failed to update role")
      }
    } catch {
      toast.error("Failed to update role")
    }
  }

  if (!authorized) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="h-16 w-16 rounded-full bg-red-50 dark:bg-red-500/15 flex items-center justify-center mb-4">
          <Shield className="h-8 w-8 text-red-400 dark:text-red-300" />
        </div>
        <h2 className="text-xl font-bold mb-2">Access Denied</h2>
        <p className="text-muted-foreground">Only super admins can manage admin users.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Users</h1>
          <p className="text-muted-foreground mt-1">
            Manage admin accounts and their roles
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Admin User
        </Button>
      </div>

      {/* Role legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(ROLE_LABELS).map(([key, { label, color, description }]) => {
          const Icon = ROLE_ICONS[key] || Shield
          return (
            <div
              key={key}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm card-lift ${color}`}
            >
              <Icon className="h-4 w-4" />
              <span className="font-medium">{label}</span>
              <span className="text-xs opacity-70 hidden sm:inline">-- {description}</span>
            </div>
          )
        })}
      </div>

      {/* Add admin form */}
      {showForm && (
        <div className="border rounded-xl p-6 bg-card shadow-sm">
          <h3 className="font-semibold text-lg mb-4">Create New Admin User</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium mb-1 block">Name</label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Dr. Full Name"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Email</label>
                <Input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="admin@example.com"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Password</label>
                <Input
                  type="password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  required
                  minLength={6}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Role</label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                  className="w-full h-10 border rounded-lg px-3 text-sm bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                >
                  <option value="reviewer">Reviewer (view only)</option>
                  <option value="admin">Admin (approve/reject/edit)</option>
                  <option value="super_admin">Super Admin (full access)</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Creating...
                  </>
                ) : (
                  "Create Admin User"
                )}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Env-var super admin notice */}
      <div className="border rounded-xl p-4 bg-amber-50/50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-400/30 card-lift">
        <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          <span>
            <strong>Environment Super Admin</strong> -- The default admin configured via environment variables always has super admin access and is not listed below.
          </span>
        </div>
      </div>

      {/* Users table */}
      {loading ? (
        <div className="border rounded-xl overflow-hidden shadow-sm bg-card">
          <div className="p-8 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground mt-2">Loading admin users...</p>
          </div>
        </div>
      ) : users.length === 0 ? (
        <div className="border rounded-xl p-12 bg-card text-center">
          <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Shield className="h-7 w-7 text-muted-foreground/40" />
          </div>
          <p className="font-semibold">No additional admin users</p>
          <p className="text-sm text-muted-foreground mt-1">
            Click "Add Admin User" to create one.
          </p>
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden shadow-sm bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/60 border-b">
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Admin User
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Role
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground hidden md:table-cell">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground hidden lg:table-cell">
                    Last Login
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((user) => {
                  const roleInfo = ROLE_LABELS[user.role] || ROLE_LABELS.reviewer
                  const RoleIcon = ROLE_ICONS[user.role] || Eye
                  const isEnvAdmin = user.id === "env-admin"
                  return (
                    <tr key={user.id} className="row-glow hover:bg-primary/5 transition-colors group">
                      <td className="px-4 py-3.5">
                        <div>
                          <p className="font-semibold">{user.name}</p>
                          <p className="text-xs text-muted-foreground">{user.email}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {isEnvAdmin ? (
                          <span
                            className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full border ${roleInfo.color}`}
                            title="Configured via environment variable"
                          >
                            {roleInfo.label}
                          </span>
                        ) : (
                          <select
                            value={user.role}
                            onChange={(e) => handleChangeRole(user, e.target.value)}
                            className={`text-xs font-semibold px-2.5 py-1 rounded-full border cursor-pointer ${roleInfo.color}`}
                          >
                            <option value="reviewer">Reviewer</option>
                            <option value="admin">Admin</option>
                            <option value="super_admin">Super Admin</option>
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3.5 hidden md:table-cell">
                        <Badge
                          variant="outline"
                          className={
                            user.is_active
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/30"
                              : "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-400/30"
                          }
                        >
                          {user.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5 hidden lg:table-cell text-xs text-muted-foreground">
                        {user.last_login
                          ? new Date(user.last_login).toLocaleString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "Never"}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-7 px-2.5 gap-1"
                            onClick={() =>
                              setActivityAdmin({
                                id: user.id,
                                email: user.email,
                                name: user.name,
                                role: user.role,
                                last_login: user.last_login,
                              })
                            }
                            title="View activity"
                          >
                            <Activity className="h-3 w-3" /> Activity
                          </Button>
                          {!isEnvAdmin && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs h-7 px-2.5 gap-1"
                                onClick={() => handleToggleActive(user)}
                                title={user.is_active ? "Deactivate" : "Activate"}
                              >
                                {user.is_active ? (
                                  <>
                                    <UserX className="h-3 w-3" /> Deactivate
                                  </>
                                ) : (
                                  <>
                                    <UserCheck className="h-3 w-3" /> Activate
                                  </>
                                )}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs h-7 px-2.5 gap-1 text-destructive hover:bg-destructive/10"
                                onClick={() => handleDelete(user)}
                              >
                                <Trash2 className="h-3 w-3" /> Delete
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AdminActivityPanel
        admin={activityAdmin}
        open={!!activityAdmin}
        onClose={() => setActivityAdmin(null)}
      />
    </div>
  )
}
