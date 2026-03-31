"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { CheckCircle, XCircle, Eye, Clock } from "lucide-react"

const pendingApplications = [
  {
    id: 1,
    name: "Dr. Vinitha R",
    email: "vinithakrishnan999@gmail.com",
    phone: "9047426050",
    type: "Associate Life Member [ALM]",
    paymentStatus: "Success",
    applicationDate: "30/03/2026",
  },
  {
    id: 2,
    name: "Dr. Anjali Agarwal",
    email: "anjaligarwal70.aa@gmail.com",
    phone: "8290668626",
    type: "Life Member [LM]",
    paymentStatus: "Success",
    applicationDate: "30/03/2026",
  },
]

export default function PendingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Pending Actions</h2>
        <p className="text-muted-foreground">
          {pendingApplications.length} applications awaiting verification
        </p>
      </div>

      <div className="grid gap-4">
        {pendingApplications.map((app) => (
          <Card key={app.id} className="hover:shadow-md transition-shadow">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback>
                      {app.name
                        .replace("Dr. ", "")
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="font-semibold">{app.name}</h3>
                    <p className="text-sm text-muted-foreground">{app.type}</p>
                    <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
                      <span>{app.email}</span>
                      <span>{app.phone}</span>
                      <span>Applied: {app.applicationDate}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant="success">{app.paymentStatus}</Badge>
                      <Badge variant="warning">
                        <Clock className="h-3 w-3 mr-1" />
                        Pending Verification
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm">
                    <Eye className="h-4 w-4 mr-1" /> View Docs
                  </Button>
                  <Button variant="success" size="sm">
                    <CheckCircle className="h-4 w-4 mr-1" /> Approve
                  </Button>
                  <Button variant="destructive" size="sm">
                    <XCircle className="h-4 w-4 mr-1" /> Reject
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {pendingApplications.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center">
            <CheckCircle className="h-12 w-12 text-success mx-auto mb-3" />
            <h3 className="font-semibold">All caught up!</h3>
            <p className="text-muted-foreground">No pending applications to review.</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
