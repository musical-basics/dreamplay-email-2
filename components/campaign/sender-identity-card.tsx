"use client"

import { User, Mail } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface SenderIdentityCardProps {
    fromName: string
    fromEmail: string
    onFromNameChange?: (value: string) => void
    onFromEmailChange?: (value: string) => void
    readOnly?: boolean
}

export function SenderIdentityCard({
    fromName,
    fromEmail,
    onFromNameChange,
    onFromEmailChange,
    readOnly = false,
}: SenderIdentityCardProps) {
    return (
        <Card className="border-border bg-card">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-medium text-foreground">
                    <User className="h-5 w-5 text-[#D4AF37]" />
                    Sender Identity
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                    Who your subscribers will see this email from.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="from-name" className="text-sm text-muted-foreground">
                        From Name
                    </Label>
                    <div className="relative">
                        <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            id="from-name"
                            value={fromName}
                            onChange={(e) => onFromNameChange?.(e.target.value)}
                            readOnly={readOnly}
                            className="pl-10 border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-[#D4AF37]"
                            placeholder="e.g., Lionel Yu"
                        />
                    </div>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="from-email" className="text-sm text-muted-foreground">
                        From Email
                    </Label>
                    <div className="relative">
                        <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground z-10" />
                        <Select value={fromEmail} onValueChange={onFromEmailChange} disabled={readOnly}>
                            <SelectTrigger id="from-email" className="pl-10 border-border bg-background text-foreground focus:ring-[#D4AF37]">
                                <SelectValue placeholder="Select email" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="lionel@musicalbasics.com">lionel@musicalbasics.com</SelectItem>
                                <SelectItem value="lionel@email.dreamplaypianos.com">lionel@email.dreamplaypianos.com</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
