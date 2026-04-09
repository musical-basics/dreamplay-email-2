"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/lib/supabase/client"

interface BulkAddDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onComplete: () => void
}

export function BulkAddDialog({
    open,
    onOpenChange,
    onComplete,
}: BulkAddDialogProps) {
    const [bulkEmails, setBulkEmails] = useState("")
    const [bulkAdding, setBulkAdding] = useState(false)
    const { toast } = useToast()
    const supabase = createClient()

    const handleBulkAdd = async () => {
        const emails = bulkEmails
            .split(/[\n,;]+/)
            .map(e => e.trim().toLowerCase())
            .filter(e => e && e.includes("@"))

        if (emails.length === 0) {
            toast({ title: "No valid emails found", variant: "destructive" })
            return
        }

        const unique = [...new Set(emails)]
        setBulkAdding(true)

        const rows = unique.map(email => ({
            email,
            first_name: "",
            last_name: "",
            country: "",
            country_code: "",
            phone_code: "",
            phone_number: "",
            shipping_address1: "",
            shipping_address2: "",
            shipping_city: "",
            shipping_zip: "",
            shipping_province: "",
            tags: [],
            status: "active" as const,
        }))

        const { error } = await supabase.from("subscribers").upsert(rows, { onConflict: "email", ignoreDuplicates: true })

        if (error) {
            toast({ title: "Error adding subscribers", description: error.message, variant: "destructive" })
        } else {
            toast({ title: `${unique.length} subscribers added`, description: "Duplicates were skipped." })
            onOpenChange(false)
            setBulkEmails("")
            onComplete()
        }
        setBulkAdding(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Bulk Add Subscribers</DialogTitle>
                    <DialogDescription>
                        Paste email addresses below — one per line, or separated by commas.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-3">
                    <Textarea
                        value={bulkEmails}
                        onChange={(e) => setBulkEmails(e.target.value)}
                        placeholder={"john@example.com\njane@example.com\nbob@example.com"}
                        rows={10}
                        className="bg-card font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                        {bulkEmails.split(/[\n,;]+/).filter(e => e.trim() && e.includes("@")).length} valid emails detected
                    </p>
                </div>
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleBulkAdd} disabled={bulkAdding} className="bg-amber-500 text-zinc-900 hover:bg-amber-400">
                        {bulkAdding ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Adding...</> : "Add All"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
