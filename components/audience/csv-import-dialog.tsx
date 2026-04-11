"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, FileUp, X, CheckCircle2, AlertTriangle, UserPlus, RefreshCw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface CsvImportDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onComplete: () => void
    workspace: string
}

// ── CSV parsing helpers ────────────────────────────────────────────────────────

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

const MERGE_FIELDS = [
    "first_name", "last_name", "country", "country_code", "phone_code",
    "phone_number", "shipping_address1", "shipping_address2",
    "shipping_city", "shipping_zip", "shipping_province",
] as const

/** Maps normalized header names → column indexes */
function buildIdxMap(headers: string[]): Record<string, number> {
    const m: Record<string, number> = {}
    headers.forEach((h, i) => {
        if (["first_name", "fname", "first", "firstname"].includes(h)) m["first_name"] = i
        if (["last_name", "lname", "last", "lastname"].includes(h)) m["last_name"] = i
        if (h === "country") m["country"] = i
        if (h === "country_code") m["country_code"] = i
        if (h === "phone_code") m["phone_code"] = i
        if (["phone", "phone_number", "tel"].includes(h)) m["phone_number"] = i
        if (["address", "address_1", "address1", "shipping_address1"].includes(h)) m["shipping_address1"] = i
        if (["address_2", "address2", "shipping_address2"].includes(h)) m["shipping_address2"] = i
        if (["city", "shipping_city"].includes(h)) m["shipping_city"] = i
        if (["zip", "postal_code", "zipcode", "zip_code", "shipping_zip"].includes(h)) m["shipping_zip"] = i
        if (["state", "province", "region", "shipping_province"].includes(h)) m["shipping_province"] = i
        if (["tags", "tag"].includes(h)) m["tags"] = i
        if (h === "status") m["status"] = i
    })
    return m
}

/** Converts a parsed CSV text into the API row shape */
function csvTextToApiRows(text: string, workspace: string): {
    rawHeaders: string[]
    previewRows: string[][]
    apiRows: Record<string, any>[]
} | { error: string } {
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) return { error: "CSV has no data rows" }

    const rawHeaders = parseCsvLine(lines[0])
    const headers = rawHeaders.map(h => h.toLowerCase().replace(/\s+/g, "_"))
    const emailIdx = headers.findIndex(h => ["email", "email_address", "e-mail"].includes(h))
    if (emailIdx === -1) return { error: "No 'email' column found — first row must be headers" }

    const idxMap = buildIdxMap(headers)
    const previewRows = lines.slice(1, 6).map(parseCsvLine)
    const rawRows = lines.slice(1).map(parseCsvLine).filter(row => row[emailIdx]?.includes("@"))

    const apiRows = rawRows.map(row => {
        const rawTags = (row[idxMap["tags"]] || "").trim()
        const rawStatus = (row[idxMap["status"]] || "").trim().toLowerCase()
        const parsed: Record<string, any> = { email: row[emailIdx].toLowerCase().trim(), workspace }
        for (const f of MERGE_FIELDS) {
            const val = idxMap[f] !== undefined ? (row[idxMap[f]] || "").trim() : ""
            parsed[f] = f === "shipping_zip" ? val.replace(/'/g, "") : val
        }
        parsed.tags = rawTags ? rawTags.split(/[;,]+/).map((t: string) => t.trim()).filter(Boolean) : []
        parsed.status = ["active", "inactive", "unsubscribed", "bounced"].includes(rawStatus) ? rawStatus : "active"
        return parsed
    })

    return { rawHeaders, previewRows, apiRows }
}

const IMPORT_BATCH_SIZE = 250

// ── Component ─────────────────────────────────────────────────────────────────

export function CsvImportDialog({ open, onOpenChange, onComplete, workspace }: CsvImportDialogProps) {
    const [csvFile, setCsvFile] = useState<File | null>(null)
    const [csvHeaders, setCsvHeaders] = useState<string[]>([])
    const [csvPreview, setCsvPreview] = useState<string[][]>([])
    const [parsedRows, setParsedRows] = useState<Record<string, any>[]>([])

    const [analyzing, setAnalyzing] = useState(false)
    const [previewData, setPreviewData] = useState<{ willAdd: number; willUpdate: number } | null>(null)

    const [csvImporting, setCsvImporting] = useState(false)
    const [importProgress, setImportProgress] = useState(0)
    const [importResult, setImportResult] = useState<{ added: number; updated: number; skipped: number } | null>(null)

    const { toast } = useToast()

    const resetState = () => {
        setCsvFile(null); setCsvHeaders([]); setCsvPreview([]); setParsedRows([])
        setAnalyzing(false); setPreviewData(null)
        setCsvImporting(false); setImportProgress(0); setImportResult(null)
    }

    const handleClose = (o: boolean) => {
        onOpenChange(o)
        if (!o) resetState()
    }

    // ── File select → parse + auto-analyze ────────────────────────────────────
    const handleFileSelect = (file: File) => {
        resetState()
        setCsvFile(file)
        setAnalyzing(true)

        const reader = new FileReader()
        reader.onload = async (e) => {
            try {
                const text = e.target?.result as string
                const parsed = csvTextToApiRows(text, workspace)

                if ("error" in parsed) {
                    toast({ title: parsed.error, variant: "destructive" })
                    setCsvFile(null)
                    return
                }

                const { rawHeaders, previewRows, apiRows } = parsed
                setCsvHeaders(rawHeaders)
                setCsvPreview(previewRows)
                setParsedRows(apiRows)

                // Hit preview endpoint (service role reads, no writes)
                const res = await fetch("/api/import-subscribers?preview=true", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ workspace, rows: apiRows }),
                })

                if (res.ok) {
                    const data = await res.json()
                    setPreviewData({ willAdd: data.willAdd, willUpdate: data.willUpdate })
                } else {
                    toast({ title: "Could not analyze CSV", description: "You can still proceed with import.", variant: "destructive" })
                }
            } catch {
                toast({ title: "Failed to parse CSV", variant: "destructive" })
                setCsvFile(null)
            } finally {
                setAnalyzing(false)
            }
        }
        reader.readAsText(file)
    }

    // ── Batched import with progress ──────────────────────────────────────────
    const handleCsvImport = async () => {
        if (!parsedRows.length) return
        setCsvImporting(true)
        setImportProgress(0)

        const totalBatches = Math.ceil(parsedRows.length / IMPORT_BATCH_SIZE)
        let totalAdded = 0
        let totalUpdated = 0

        try {
            for (let i = 0; i < parsedRows.length; i += IMPORT_BATCH_SIZE) {
                const chunk = parsedRows.slice(i, i + IMPORT_BATCH_SIZE)
                const res = await fetch("/api/import-subscribers", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ workspace, rows: chunk }),
                })
                const result = await res.json()

                if (!res.ok) {
                    toast({ title: "Import failed", description: result.error ?? "Unknown error", variant: "destructive" })
                    return
                }

                totalAdded += result.added
                totalUpdated += result.updated
                const batchesDone = Math.floor(i / IMPORT_BATCH_SIZE) + 1
                setImportProgress(Math.round((batchesDone / totalBatches) * 100))
            }

            const skipped = parsedRows.length - totalAdded - totalUpdated
            setImportResult({ added: totalAdded, updated: totalUpdated, skipped })
            onComplete()
        } finally {
            setCsvImporting(false)
        }
    }

    // ── Render ────────────────────────────────────────────────────────────────
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
                    {/* ── SUCCESS ── */}
                    {importResult ? (
                        <div className="rounded-lg border border-border bg-muted/30 p-5 space-y-3">
                            <div className="flex items-center gap-2 text-emerald-400">
                                <CheckCircle2 className="w-5 h-5" />
                                <p className="font-semibold text-sm">Import complete</p>
                            </div>
                            <div className="grid grid-cols-3 gap-3 text-center">
                                <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 p-3">
                                    <p className="text-2xl font-bold text-emerald-400">{importResult.added.toLocaleString()}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">Added</p>
                                </div>
                                <div className="rounded-md bg-sky-500/10 border border-sky-500/20 p-3">
                                    <p className="text-2xl font-bold text-sky-400">{importResult.updated.toLocaleString()}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">Updated</p>
                                </div>
                                <div className="rounded-md bg-muted/50 border border-border p-3">
                                    <p className="text-2xl font-bold text-muted-foreground">{importResult.skipped.toLocaleString()}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">Unchanged</p>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Workspace: <span className="text-foreground font-medium">{workspace}</span>
                            </p>
                        </div>

                    /* ── DROPZONE ── */
                    ) : !csvFile ? (
                        <label className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border p-8 cursor-pointer hover:bg-muted/50 transition-colors">
                            <FileUp className="h-10 w-10 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Click to select a CSV file</span>
                            <input
                                type="file"
                                accept=".csv,text/csv"
                                className="hidden"
                                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                            />
                        </label>

                    /* ── FILE SELECTED ── */
                    ) : (
                        <>
                            {/* File header + clear button */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 min-w-0">
                                    <FileUp className="h-4 w-4 text-amber-500 flex-shrink-0" />
                                    <span className="text-sm font-medium truncate">{csvFile.name}</span>
                                    <span className="text-xs text-muted-foreground flex-shrink-0">
                                        ({(csvFile.size / 1024).toFixed(1)} KB · {parsedRows.length.toLocaleString()} rows)
                                    </span>
                                </div>
                                {!csvImporting && (
                                    <Button variant="ghost" size="sm" onClick={resetState}>
                                        <X className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>

                            {/* Workspace scope warning */}
                            <div className="flex items-center gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                                <p className="text-xs text-amber-400">
                                    Will import into <span className="font-semibold">{workspace}</span> only.
                                    Existing rows in other workspaces are unaffected.
                                </p>
                            </div>

                            {/* Conflict preview / analyzing */}
                            {analyzing ? (
                                <div className="flex items-center gap-2.5 rounded-md bg-muted/50 border border-border px-3 py-3">
                                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground flex-shrink-0" />
                                    <p className="text-xs text-muted-foreground">Analyzing CSV against workspace…</p>
                                </div>
                            ) : previewData ? (
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="flex items-center gap-3 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-3">
                                        <UserPlus className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                        <div>
                                            <p className="text-lg font-bold text-emerald-400">{previewData.willAdd.toLocaleString()}</p>
                                            <p className="text-xs text-muted-foreground">new subscribers</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 rounded-md bg-sky-500/10 border border-sky-500/20 px-3 py-3">
                                        <RefreshCw className="w-4 h-4 text-sky-400 flex-shrink-0" />
                                        <div>
                                            <p className="text-lg font-bold text-sky-400">{previewData.willUpdate.toLocaleString()}</p>
                                            <p className="text-xs text-muted-foreground">will be updated</p>
                                        </div>
                                    </div>
                                </div>
                            ) : null}

                            {/* Progress bar (shown during import) */}
                            {csvImporting && (
                                <div className="space-y-1.5">
                                    <div className="flex justify-between text-xs text-muted-foreground">
                                        <span>Importing…</span>
                                        <span>{importProgress}%</span>
                                    </div>
                                    <div className="rounded-full bg-muted h-2 overflow-hidden">
                                        <div
                                            className="h-full bg-amber-500 transition-all duration-300 ease-out"
                                            style={{ width: `${importProgress}%` }}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* CSV table preview (hidden while importing) */}
                            {!csvImporting && csvHeaders.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-xs text-muted-foreground">
                                        <span className="font-medium text-foreground">{csvHeaders.length}</span> columns detected · Preview (first {csvPreview.length} rows):
                                    </p>
                                    <div className="rounded border border-border overflow-auto max-h-[200px]">
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
                        <Button
                            onClick={handleCsvImport}
                            disabled={!csvFile || csvImporting || analyzing || !previewData}
                            className="bg-amber-500 text-zinc-900 hover:bg-amber-400"
                        >
                            {csvImporting
                                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing…</>
                                : analyzing
                                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analyzing…</>
                                    : "Import"
                            }
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
