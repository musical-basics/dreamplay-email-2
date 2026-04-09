"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, FileUp, X } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/lib/supabase/client"

interface CsvImportDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onComplete: () => void
}

function parseCsvLine(line: string): string[] {
    const result: string[] = []
    let current = ""
    let inQuotes = false
    for (const char of line) {
        if (char === '"') { inQuotes = !inQuotes }
        else if (char === ',' && !inQuotes) { result.push(current.trim()); current = "" }
        else { current += char }
    }
    result.push(current.trim())
    return result
}

export function CsvImportDialog({
    open,
    onOpenChange,
    onComplete,
}: CsvImportDialogProps) {
    const [csvFile, setCsvFile] = useState<File | null>(null)
    const [csvPreview, setCsvPreview] = useState<string[][]>([])
    const [csvHeaders, setCsvHeaders] = useState<string[]>([])
    const [csvImporting, setCsvImporting] = useState(false)
    const { toast } = useToast()
    const supabase = createClient()

    const handleClose = (o: boolean) => {
        onOpenChange(o)
        if (!o) { setCsvFile(null); setCsvPreview([]); setCsvHeaders([]) }
    }

    const handleCsvFileSelect = (file: File) => {
        setCsvFile(file)
        const reader = new FileReader()
        reader.onload = (e) => {
            const text = e.target?.result as string
            const lines = text.split(/\r?\n/).filter(l => l.trim())
            if (lines.length === 0) return

            const headers = parseCsvLine(lines[0])
            setCsvHeaders(headers)
            const rows = lines.slice(1, 6).map(parseCsvLine)
            setCsvPreview(rows)
        }
        reader.readAsText(file)
    }

    const handleCsvImport = async () => {
        if (!csvFile) return
        setCsvImporting(true)

        const reader = new FileReader()
        reader.onload = async (e) => {
            const text = e.target?.result as string
            const lines = text.split(/\r?\n/).filter(l => l.trim())
            if (lines.length < 2) {
                toast({ title: "CSV has no data rows", variant: "destructive" })
                setCsvImporting(false)
                return
            }

            const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, "_"))
            const emailIdx = headers.findIndex(h => h === "email" || h === "email_address" || h === "e-mail")
            if (emailIdx === -1) {
                toast({ title: "No 'email' column found in CSV", description: "First row must contain headers with an 'email' column.", variant: "destructive" })
                setCsvImporting(false)
                return
            }

            // Map common column names to our fields
            const idxMap: Record<string, number> = {}
            headers.forEach((h, i) => {
                if (h === "first_name" || h === "fname" || h === "first" || h === "firstname") idxMap["first_name"] = i
                if (h === "last_name" || h === "lname" || h === "last" || h === "lastname") idxMap["last_name"] = i
                if (h === "country") idxMap["country"] = i
                if (h === "country_code") idxMap["country_code"] = i
                if (h === "phone_code") idxMap["phone_code"] = i
                if (h === "phone" || h === "phone_number" || h === "tel") idxMap["phone_number"] = i
                if (h === "address" || h === "address_1" || h === "address1" || h === "shipping_address1") idxMap["shipping_address1"] = i
                if (h === "address_2" || h === "address2" || h === "shipping_address2") idxMap["shipping_address2"] = i
                if (h === "city" || h === "shipping_city") idxMap["shipping_city"] = i
                if (h === "zip" || h === "postal_code" || h === "zipcode" || h === "zip_code" || h === "shipping_zip") idxMap["shipping_zip"] = i
                if (h === "state" || h === "province" || h === "region" || h === "shipping_province") idxMap["shipping_province"] = i
                if (h === "tags" || h === "tag") idxMap["tags"] = i
                if (h === "status") idxMap["status"] = i
            })

            const rows = lines.slice(1).map(parseCsvLine).filter(row => row[emailIdx]?.includes("@"))

            const mergeFields = ["first_name", "last_name", "country", "country_code", "phone_code", "phone_number", "shipping_address1", "shipping_address2", "shipping_city", "shipping_zip", "shipping_province"] as const
            type MergeField = typeof mergeFields[number]

            const csvRows = rows.map(row => {
                const rawTags = (row[idxMap["tags"]] || "").trim()
                const rawStatus = (row[idxMap["status"]] || "").trim().toLowerCase()
                const parsed: Record<string, string | string[]> = {
                    email: row[emailIdx].toLowerCase().trim(),
                }
                for (const f of mergeFields) {
                    const val = idxMap[f] !== undefined ? (row[idxMap[f]] || "").trim() : ""
                    parsed[f] = f === "shipping_zip" ? val.replace(/'/g, "") : val
                }
                parsed._tags = rawTags ? rawTags.split(/[;,]+/).map((t: string) => t.trim()).filter(Boolean) : []
                parsed._status = (["active", "inactive", "unsubscribed", "bounced"].includes(rawStatus) ? rawStatus : "")
                return parsed
            })

            // Gather all emails to look up existing records
            const allEmails = csvRows.map(r => r.email as string)

            // Fetch existing subscribers in batches of 500
            const existingMap = new Map<string, any>()
            for (let i = 0; i < allEmails.length; i += 500) {
                const batch = allEmails.slice(i, i + 500)
                const { data } = await supabase
                    .from("subscribers")
                    .select("*")
                    .in("email", batch)
                if (data) {
                    for (const row of data) {
                        existingMap.set(row.email, row)
                    }
                }
            }

            const toInsert: any[] = []
            const toUpdate: { id: string; payload: any }[] = []

            for (const csvRow of csvRows) {
                const email = csvRow.email as string
                const existing = existingMap.get(email)
                const csvTags = csvRow._tags as string[]
                const csvStatus = csvRow._status as string

                if (existing) {
                    const updates: Record<string, any> = {}
                    for (const f of mergeFields) {
                        const csvVal = csvRow[f] as string
                        if (csvVal) {
                            updates[f] = csvVal
                        }
                    }
                    if (csvTags.length > 0) {
                        const existingTags: string[] = existing.tags || []
                        updates.tags = [...new Set([...existingTags, ...csvTags])]
                    }
                    if (csvStatus) {
                        updates.status = csvStatus
                    }
                    if (Object.keys(updates).length > 0) {
                        toUpdate.push({ id: existing.id, payload: updates })
                    }
                } else {
                    const newSub: Record<string, any> = { email }
                    for (const f of mergeFields) {
                        newSub[f] = (csvRow[f] as string) || ""
                    }
                    newSub.tags = csvTags
                    newSub.status = csvStatus || "active"
                    toInsert.push(newSub)
                }
            }

            let addedCount = 0
            let updatedCount = 0

            for (let i = 0; i < toInsert.length; i += 500) {
                const chunk = toInsert.slice(i, i + 500)
                const { error } = await supabase.from("subscribers").insert(chunk)
                if (error) {
                    toast({ title: "Error inserting new subscribers", description: error.message, variant: "destructive" })
                    setCsvImporting(false)
                    return
                }
                addedCount += chunk.length
            }

            for (const { id, payload } of toUpdate) {
                const { error } = await supabase.from("subscribers").update(payload).eq("id", id)
                if (error) {
                    console.error(`Failed to update subscriber ${id}:`, error.message)
                } else {
                    updatedCount++
                }
            }

            const parts: string[] = []
            if (addedCount > 0) parts.push(`${addedCount} added`)
            if (updatedCount > 0) parts.push(`${updatedCount} updated`)
            const skipped = csvRows.length - addedCount - updatedCount
            if (skipped > 0) parts.push(`${skipped} unchanged`)

            toast({ title: `Import complete`, description: parts.join(", ") + "." })
            handleClose(false)
            onComplete()
            setCsvImporting(false)
        }
        reader.readAsText(csvFile)
    }

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Import CSV</DialogTitle>
                    <DialogDescription>
                        Upload a CSV file with subscriber data. The first row must be headers and must include an &quot;email&quot; column.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    {!csvFile ? (
                        <label className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border p-8 cursor-pointer hover:bg-muted/50 transition-colors">
                            <FileUp className="h-10 w-10 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Click to select a CSV file</span>
                            <input
                                type="file"
                                accept=".csv,text/csv"
                                className="hidden"
                                onChange={(e) => e.target.files?.[0] && handleCsvFileSelect(e.target.files[0])}
                            />
                        </label>
                    ) : (
                        <>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 min-w-0">
                                    <FileUp className="h-4 w-4 text-amber-500 flex-shrink-0" />
                                    <span className="text-sm font-medium truncate">{csvFile.name}</span>
                                    <span className="text-xs text-muted-foreground flex-shrink-0">({(csvFile.size / 1024).toFixed(1)} KB)</span>
                                </div>
                                <Button variant="ghost" size="sm" onClick={() => { setCsvFile(null); setCsvPreview([]); setCsvHeaders([]) }}>
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>

                            {csvHeaders.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-xs text-muted-foreground">
                                        <span className="font-medium text-foreground">{csvHeaders.length}</span> columns detected · Preview (first {csvPreview.length} rows):
                                    </p>
                                    <div className="rounded border border-border overflow-auto max-h-[250px]">
                                        <table className="text-xs">
                                            <thead className="sticky top-0">
                                                <tr className="border-b border-border bg-muted">
                                                    {csvHeaders.map((h, i) => (
                                                        <th key={i} className="px-2 py-1.5 text-left font-medium text-foreground whitespace-nowrap">{h}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {csvPreview.map((row, ri) => (
                                                    <tr key={ri} className="border-b border-border last:border-0">
                                                        {csvHeaders.map((_, ci) => (
                                                            <td key={ci} className="px-2 py-1 text-muted-foreground whitespace-nowrap max-w-[120px] truncate">{row[ci] || ""}</td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
                    <Button onClick={handleCsvImport} disabled={!csvFile || csvImporting} className="bg-amber-500 text-zinc-900 hover:bg-amber-400">
                        {csvImporting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing...</> : "Import"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
