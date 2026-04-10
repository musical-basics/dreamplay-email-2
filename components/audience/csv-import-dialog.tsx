"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, FileUp, X, CheckCircle2, AlertTriangle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface CsvImportDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onComplete: () => void
    workspace: string
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
    workspace,
}: CsvImportDialogProps) {
    const [csvFile, setCsvFile] = useState<File | null>(null)
    const [csvPreview, setCsvPreview] = useState<string[][]>([])
    const [csvHeaders, setCsvHeaders] = useState<string[]>([])
    const [csvImporting, setCsvImporting] = useState(false)
    const [importResult, setImportResult] = useState<{ added: number; updated: number; skipped: number } | null>(null)
    const { toast } = useToast()

    const handleClose = (o: boolean) => {
        onOpenChange(o)
        if (!o) { setCsvFile(null); setCsvPreview([]); setCsvHeaders([]); setImportResult(null) }
    }

    const handleCsvFileSelect = (file: File) => {
        setCsvFile(file)
        setImportResult(null)
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
            try {
                const text = e.target?.result as string
                const lines = text.split(/\r?\n/).filter(l => l.trim())
                if (lines.length < 2) {
                    toast({ title: "CSV has no data rows", variant: "destructive" })
                    return
                }

                const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, "_"))
                const emailIdx = headers.findIndex(h => h === "email" || h === "email_address" || h === "e-mail")
                if (emailIdx === -1) {
                    toast({ title: "No 'email' column found in CSV", description: "First row must contain headers with an 'email' column.", variant: "destructive" })
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

                const mergeFields = [
                    "first_name", "last_name", "country", "country_code", "phone_code",
                    "phone_number", "shipping_address1", "shipping_address2",
                    "shipping_city", "shipping_zip", "shipping_province",
                ] as const

                const rawRows = lines.slice(1).map(parseCsvLine).filter(row => row[emailIdx]?.includes("@"))

                // Build structured rows to send to the server
                const apiRows = rawRows.map(row => {
                    const rawTags = (row[idxMap["tags"]] || "").trim()
                    const rawStatus = (row[idxMap["status"]] || "").trim().toLowerCase()
                    const parsed: Record<string, any> = {
                        email: row[emailIdx].toLowerCase().trim(),
                        workspace,
                    }
                    for (const f of mergeFields) {
                        const val = idxMap[f] !== undefined ? (row[idxMap[f]] || "").trim() : ""
                        parsed[f] = f === "shipping_zip" ? val.replace(/'/g, "") : val
                    }
                    parsed.tags = rawTags ? rawTags.split(/[;,]+/).map((t: string) => t.trim()).filter(Boolean) : []
                    parsed.status = ["active", "inactive", "unsubscribed", "bounced"].includes(rawStatus) ? rawStatus : "active"
                    return parsed
                })

                // Send to server-side API (uses service role key — bypasses RLS, safe upsert)
                const res = await fetch("/api/import-subscribers", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ workspace, rows: apiRows }),
                })

                const result = await res.json()

                if (!res.ok) {
                    toast({ title: "Import failed", description: result.error ?? "Unknown error", variant: "destructive" })
                    return
                }

                setImportResult({ added: result.added, updated: result.updated, skipped: result.skipped })
                onComplete()
            } finally {
                setCsvImporting(false)
            }
        }
        reader.readAsText(csvFile)
    }

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Import CSV</DialogTitle>
                    <DialogDescription>
                        Importing into <span className="font-semibold text-foreground">{workspace}</span>.
                        The same email can exist in multiple workspaces — this import only affects this workspace.
                        First row must be headers with an &quot;email&quot; column.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    {importResult ? (
                        <div className="rounded-lg border border-border bg-muted/30 p-5 space-y-3">
                            <div className="flex items-center gap-2 text-emerald-400">
                                <CheckCircle2 className="w-5 h-5" />
                                <p className="font-semibold text-sm">Import complete</p>
                            </div>
                            <div className="grid grid-cols-3 gap-3 text-center">
                                <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 p-3">
                                    <p className="text-2xl font-bold text-emerald-400">{importResult.added}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">Added</p>
                                </div>
                                <div className="rounded-md bg-sky-500/10 border border-sky-500/20 p-3">
                                    <p className="text-2xl font-bold text-sky-400">{importResult.updated}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">Updated</p>
                                </div>
                                <div className="rounded-md bg-muted/50 border border-border p-3">
                                    <p className="text-2xl font-bold text-muted-foreground">{importResult.skipped}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">Unchanged</p>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Workspace: <span className="text-foreground font-medium">{workspace}</span>
                            </p>
                        </div>
                    ) : !csvFile ? (
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

                            <div className="flex items-center gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                                <p className="text-xs text-amber-400">
                                    Will import into <span className="font-semibold">{workspace}</span> only.
                                    Existing rows in other workspaces are unaffected.
                                </p>
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
                    <Button variant="outline" onClick={() => handleClose(false)}>
                        {importResult ? "Close" : "Cancel"}
                    </Button>
                    {!importResult && (
                        <Button onClick={handleCsvImport} disabled={!csvFile || csvImporting} className="bg-amber-500 text-zinc-900 hover:bg-amber-400">
                            {csvImporting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing...</> : "Import"}
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
