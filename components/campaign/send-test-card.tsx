"use client"

import { useState } from "react"
import { Send, CheckCircle2, Loader2, Mail } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"

interface SendTestCardProps {
    onSendTest: (email: string) => Promise<void>
}

const TEST_EMAILS = [
    "musicalbasics@gmail.com",
    "djsputty@gmail.com",
] as const

export function SendTestCard({ onSendTest }: SendTestCardProps) {
    const [email, setEmail] = useState<string>(TEST_EMAILS[0])
    const [isSending, setIsSending] = useState(false)
    const [isSent, setIsSent] = useState(false)

    const handleSendTest = async () => {
        if (!email) return

        setIsSending(true)
        try {
            await onSendTest(email)
            setIsSent(true)
            setTimeout(() => {
                setIsSent(false)
            }, 3000)
        } finally {
            setIsSending(false)
        }
    }

    return (
        <Card className="border-border bg-card">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-medium text-foreground">
                    <Send className="h-5 w-5 text-[#D4AF37]" />
                    Send Test Email
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                    Verify the HTML renders correctly before broadcast.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex gap-3">
                    <div className="relative flex-1">
                        <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground z-10" />
                        <Select value={email} onValueChange={setEmail}>
                            <SelectTrigger className="pl-10 border-border bg-background text-foreground focus:ring-[#D4AF37]">
                                <SelectValue placeholder="Select test email" />
                            </SelectTrigger>
                            <SelectContent>
                                {TEST_EMAILS.map((e) => (
                                    <SelectItem key={e} value={e}>{e}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <Button
                        variant="secondary"
                        onClick={handleSendTest}
                        disabled={!email || isSending || isSent}
                        className="gap-2 bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    >
                        {isSending ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Sending
                            </>
                        ) : isSent ? (
                            <>
                                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                Sent!
                            </>
                        ) : (
                            "Send Test"
                        )}
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}
