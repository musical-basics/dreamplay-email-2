"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
    Upload,
    FileText,
    Image as ImageIcon,
    Sparkles,
    Loader2,
    CheckCircle2,
    AlertCircle,
    X,
    Cpu,
    ChevronDown,
} from "lucide-react"
import { processMigration, processMigrationToDnd, analyzeMailchimpFile } from "@/app/actions/migrations"
import { compressImages } from "@/lib/utils/compress-image"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"

interface AnalysisResult {
    title: string
    previewText: string
    imageCount: number
    blockCount: number
    linkCount: number
    summary: string
}

type AiMode = "both" | "gemini" | "claude"
type ImportMode = "ai" | "dnd"

interface ModelInfo {
    id: string
    name: string
    provider: "gemini" | "anthropic"
}

export default function MigratePage() {
    const router = useRouter()
    const { toast } = useToast()
    const [htmlFile, setHtmlFile] = useState<File | null>(null)
    const [assetFiles, setAssetFiles] = useState<File[]>([])
    const [templateName, setTemplateName] = useState("")
    const [isDragging, setIsDragging] = useState(false)
    const [isAnalyzing, setIsAnalyzing] = useState(false)
    const [isConverting, setIsConverting] = useState(false)
    const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isCompressing, setIsCompressing] = useState(false)
    const [compressionStatus, setCompressionStatus] = useState("")
    const [aiMode, setAiMode] = useState<AiMode>("both")
    const [importMode, setImportMode] = useState<ImportMode>("dnd")
    const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
    const [selectedGeminiModel, setSelectedGeminiModel] = useState("")
    const [selectedClaudeModel, setSelectedClaudeModel] = useState("")
    const [loadingModels, setLoadingModels] = useState(true)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const assetInputRef = useRef<HTMLInputElement>(null)

    // Fetch available models on mount
    useEffect(() => {
        async function fetchModels() {
            try {
                const res = await fetch("/api/models")
                const data = await res.json()
                const models: ModelInfo[] = data.models || []
                setAvailableModels(models)
                const firstGemini = models.find((m) => m.provider === "gemini")
                const firstClaude = models.find((m) => m.provider === "anthropic")
                if (firstGemini) setSelectedGeminiModel(firstGemini.id)
                if (firstClaude) setSelectedClaudeModel(firstClaude.id)
            } catch {
                console.error("Failed to fetch models")
            } finally {
                setLoadingModels(false)
            }
        }
        fetchModels()
    }, [])

    const geminiModels = availableModels.filter((m) => m.provider === "gemini")
    const claudeModels = availableModels.filter((m) => m.provider === "anthropic")

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
    }, [])

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)

        const files = Array.from(e.dataTransfer.files)
        const html = files.find((f) => f.name.endsWith(".html") || f.name.endsWith(".htm"))
        const assets = files.filter(
            (f) =>
                f.name.endsWith(".png") ||
                f.name.endsWith(".jpg") ||
                f.name.endsWith(".jpeg") ||
                f.name.endsWith(".gif")
        )

        if (html) {
            setHtmlFile(html)
            setTemplateName(html.name.replace(/\.(html|htm)$/, ""))
            const text = await html.text()
            await runAnalysis(text)
        }
        if (assets.length > 0) {
            setAssetFiles((prev) => [...prev, ...assets])
        }
    }, [])

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) {
            setHtmlFile(file)
            setTemplateName(file.name.replace(/\.(html|htm)$/, ""))
            const text = await file.text()
            await runAnalysis(text)
        }
    }

    const handleAssetSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || [])
        setAssetFiles((prev) => [...prev, ...files])
    }

    const runAnalysis = async (htmlContent: string) => {
        setIsAnalyzing(true)
        setError(null)
        try {
            const result = await analyzeMailchimpFile(htmlContent)
            setAnalysis(result)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Analysis failed")
        } finally {
            setIsAnalyzing(false)
        }
    }

    const handleConvert = async () => {
        if (!htmlFile) return
        setError(null)

        // Step 1: Compress images over 300KB before sending
        let filesToSend = assetFiles
        const oversized = assetFiles.filter((f) => f.size > 300 * 1024)
        if (oversized.length > 0) {
            setIsCompressing(true)
            setCompressionStatus(`Compressing ${oversized.length} large image${oversized.length > 1 ? "s" : ""}...`)
            try {
                const { files: compressed, stats } = await compressImages(
                    assetFiles,
                    300 * 1024,
                    (index, total, filename) => {
                        setCompressionStatus(`Compressing ${index + 1}/${total}: ${filename}`)
                    }
                )
                filesToSend = compressed
                setAssetFiles(compressed) // Update UI with compressed files
                if (stats.compressedCount > 0) {
                    const savedMB = ((stats.originalTotalBytes - stats.compressedTotalBytes) / (1024 * 1024)).toFixed(1)
                    console.log(`[Compress] Compressed ${stats.compressedCount} images, saved ${savedMB} MB`)
                }
            } catch (err) {
                console.error("Compression error:", err)
                // Fall through — try with original files
            } finally {
                setIsCompressing(false)
                setCompressionStatus("")
            }
        }

        // Step 2: Build FormData and send
        setIsConverting(true)
        try {
            const formData = new FormData()
            formData.append("htmlFile", htmlFile)
            formData.append("templateName", templateName || "Untitled Migration")
            formData.append("aiMode", aiMode)
            formData.append("geminiModel", selectedGeminiModel)
            formData.append("claudeModel", selectedClaudeModel)
            filesToSend.forEach((f, i) => formData.append(`asset_${i}`, f))

            if (importMode === "dnd") {
                // Direct HTML import — faithful carbon copy, no AI
                const result = await processMigrationToDnd(formData)
                if (result.success && result.campaignId) {
                    toast({
                        title: "Import Complete",
                        description: `"${templateName}" has been imported as a carbon copy.`,
                    })
                    router.push(`/editor?id=${result.campaignId}`)
                } else {
                    setError(result.error || "Import failed")
                }
            } else {
                // AI template import
                const result = await processMigration(formData)
                if (result.success && result.campaignId) {
                    toast({
                        title: "Migration Complete",
                        description: `"${templateName}" has been created as a Master Template.`,
                    })
                    router.push(`/editor?id=${result.campaignId}`)
                } else {
                    setError(result.error || "Conversion failed")
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Conversion failed")
        } finally {
            setIsConverting(false)
        }
    }

    const resetState = () => {
        setHtmlFile(null)
        setAssetFiles([])
        setTemplateName("")
        setAnalysis(null)
        setError(null)
    }

    return (
        <div className="p-6 max-w-6xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-foreground">Mailchimp Import</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Upload a Mailchimp HTML export and its images. AI will convert it into a clean Master Template.
                </p>
            </div>

            {/* Error Banner */}
            {error && (
                <div className="mb-6 flex items-center gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                    <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
                    <p className="text-sm text-destructive">{error}</p>
                    <button onClick={() => setError(null)} className="ml-auto">
                        <X className="w-4 h-4 text-destructive" />
                    </button>
                </div>
            )}

            {!htmlFile ? (
                /* ─── Drop Zone ─── */
                <Card
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`relative border-2 border-dashed p-16 text-center transition-all duration-300 cursor-pointer
                        ${isDragging ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"}`}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-primary/10 flex items-center justify-center">
                        <Upload className="w-8 h-8 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                        Drag & Drop Source Files
                    </h3>
                    <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
                        Drop your Mailchimp HTML export and image assets here, or click to browse.
                        Supports{" "}
                        <code className="text-primary">.html</code>,{" "}
                        <code className="text-primary">.png</code>,{" "}
                        <code className="text-primary">.jpg</code> files.
                    </p>
                    <div className="flex items-center justify-center gap-4">
                        <Button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                        >
                            <FileText className="w-4 h-4 mr-2" />
                            Select HTML File
                        </Button>
                        <Button
                            variant="outline"
                            type="button"
                            onClick={(e) => { e.stopPropagation(); assetInputRef.current?.click() }}
                        >
                            <ImageIcon className="w-4 h-4 mr-2" />
                            Add Images
                        </Button>
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".html,.htm"
                        className="hidden"
                        onChange={handleFileSelect}
                    />
                    <input
                        ref={assetInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handleAssetSelect}
                    />
                </Card>
            ) : (
                /* ─── Analysis & Convert Panel ─── */
                <div className="grid grid-cols-5 gap-6">
                    {/* Left: Controls */}
                    <div className="col-span-2 space-y-4">
                        {/* File Info */}
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm">Source File</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                                    <FileText className="w-5 h-5 text-primary" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-foreground truncate">
                                            {htmlFile.name}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {(htmlFile.size / 1024).toFixed(1)} KB
                                        </p>
                                    </div>
                                    <button
                                        onClick={resetState}
                                        className="text-muted-foreground hover:text-destructive"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Template Name */}
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm">Template Name</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <Input
                                    value={templateName}
                                    onChange={(e) => setTemplateName(e.target.value)}
                                    placeholder="My Email Template"
                                />
                            </CardContent>
                        </Card>

                        {/* Import Mode */}
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <Cpu className="w-4 h-4 text-primary" />
                                    Import Mode
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {/* Import mode toggle */}
                                <div className="flex gap-1 p-1 rounded-lg bg-muted/50">
                                    <button
                                        onClick={() => setImportMode("dnd")}
                                        className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors
                                            ${importMode === "dnd"
                                                ? "bg-primary text-primary-foreground"
                                                : "text-muted-foreground hover:text-foreground"}`}
                                    >
                                        Direct Import
                                    </button>
                                    <button
                                        onClick={() => setImportMode("ai")}
                                        className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors
                                            ${importMode === "ai"
                                                ? "bg-primary text-primary-foreground"
                                                : "text-muted-foreground hover:text-foreground"}`}
                                    >
                                        AI Template
                                    </button>
                                </div>
                                <p className="text-[10px] text-muted-foreground">
                                    {importMode === "dnd"
                                        ? "Carbon copy of original HTML. Replaces image URLs with uploaded assets. Fast, no AI."
                                        : "Uses AI to generate clean HTML template. Takes 30-60s."}
                                </p>

                                {/* AI options — only shown for AI mode */}
                                {importMode === "ai" && (
                                    <>
                                        {/* AI Pipeline mode */}
                                        <div className="flex gap-1 p-1 rounded-lg bg-muted/50">
                                            {(["both", "gemini", "claude"] as const).map((mode) => (
                                                <button
                                                    key={mode}
                                                    onClick={() => setAiMode(mode)}
                                                    className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors
                                                        ${aiMode === mode
                                                            ? "bg-primary text-primary-foreground"
                                                            : "text-muted-foreground hover:text-foreground"}`}
                                                >
                                                    {mode === "both" ? "Both" : mode === "gemini" ? "Gemini" : "Claude"}
                                                </button>
                                            ))}
                                        </div>

                                        {/* Gemini model dropdown */}
                                        {(aiMode === "both" || aiMode === "gemini") && (
                                            <div>
                                                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                                                    {aiMode === "both" ? "Analysis Model (Gemini)" : "Gemini Model"}
                                                </Label>
                                                <div className="relative">
                                                    <select
                                                        value={selectedGeminiModel}
                                                        onChange={(e) => setSelectedGeminiModel(e.target.value)}
                                                        className="w-full appearance-none px-3 py-2 pr-8 rounded-md bg-muted/50 border border-border text-sm text-foreground focus:outline-none focus:border-primary cursor-pointer"
                                                    >
                                                        {loadingModels ? (
                                                            <option>Loading models...</option>
                                                        ) : geminiModels.length === 0 ? (
                                                            <option>No Gemini models — check API key</option>
                                                        ) : (
                                                            geminiModels.map((m) => (
                                                                <option key={m.id} value={m.id}>{m.name}</option>
                                                            ))
                                                        )}
                                                    </select>
                                                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                                                </div>
                                            </div>
                                        )}

                                        {/* Claude model dropdown */}
                                        {(aiMode === "both" || aiMode === "claude") && (
                                            <div>
                                                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                                                    {aiMode === "both" ? "Generation Model (Claude)" : "Claude Model"}
                                                </Label>
                                                <div className="relative">
                                                    <select
                                                        value={selectedClaudeModel}
                                                        onChange={(e) => setSelectedClaudeModel(e.target.value)}
                                                        className="w-full appearance-none px-3 py-2 pr-8 rounded-md bg-muted/50 border border-border text-sm text-foreground focus:outline-none focus:border-primary cursor-pointer"
                                                    >
                                                        {loadingModels ? (
                                                            <option>Loading models...</option>
                                                        ) : claudeModels.length === 0 ? (
                                                            <option>No Claude models — check API key</option>
                                                        ) : (
                                                            claudeModels.map((m) => (
                                                                <option key={m.id} value={m.id}>{m.name}</option>
                                                            ))
                                                        )}
                                                    </select>
                                                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </CardContent>
                        </Card>

                        {/* Assets */}
                        <Card>
                            <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-sm">
                                        Assets ({assetFiles.length})
                                    </CardTitle>
                                    <button
                                        onClick={() => assetInputRef.current?.click()}
                                        className="text-xs text-primary hover:underline"
                                    >
                                        + Add
                                    </button>
                                </div>
                            </CardHeader>
                            <CardContent>
                                {assetFiles.length > 0 ? (
                                    <div className="space-y-2 max-h-48 overflow-y-auto">
                                        {assetFiles.map((f, i) => (
                                            <div
                                                key={i}
                                                className="flex items-center gap-2 p-2 rounded-lg bg-muted/50"
                                            >
                                                <ImageIcon className="w-4 h-4 text-blue-400" />
                                                <span className="text-xs text-foreground truncate flex-1">
                                                    {f.name}
                                                </span>
                                                <Badge variant="secondary" className="text-[10px]">
                                                    {(f.size / 1024).toFixed(0)} KB
                                                </Badge>
                                                <button
                                                    onClick={() =>
                                                        setAssetFiles((prev) => prev.filter((_, j) => j !== i))
                                                    }
                                                    className="text-muted-foreground hover:text-destructive"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-muted-foreground">
                                        No assets added. Drop images alongside the HTML file, or click &quot;+ Add&quot;.
                                    </p>
                                )}
                                <input
                                    ref={assetInputRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    className="hidden"
                                    onChange={handleAssetSelect}
                                />
                            </CardContent>
                        </Card>

                        {/* Convert Button */}
                        <Button
                            onClick={handleConvert}
                            disabled={isCompressing || isConverting || !htmlFile}
                            className="w-full h-12 text-base"
                            size="lg"
                        >
                            {isCompressing ? (
                                <>
                                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                    Compressing Images...
                                </>
                            ) : isConverting ? (
                                <>
                                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                    {importMode === "dnd" ? "Importing..." : "Converting with AI..."}
                                </>
                            ) : (
                                <>
                                    <Sparkles className="w-5 h-5 mr-2" />
                                    {importMode === "dnd" ? "Import as Carbon Copy" : "Convert & Save as Template"}
                                </>
                            )}
                        </Button>

                        {isCompressing && compressionStatus && (
                            <p className="text-xs text-amber-400 text-center">
                                {compressionStatus}
                            </p>
                        )}
                        {isConverting && (
                            <p className="text-xs text-muted-foreground text-center">
                                {importMode === "dnd"
                                    ? "Uploading images and processing HTML..."
                                    : "Uploading images, analyzing structure, and generating HTML. This may take 30–60 seconds."}
                            </p>
                        )}
                    </div>

                    {/* Right: Analysis Panel */}
                    <div className="col-span-3">
                        <Card className="h-full">
                            <CardHeader>
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <Sparkles className="w-4 h-4 text-primary" />
                                    Content Analysis
                                    {isAnalyzing && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {analysis ? (
                                    <div className="space-y-4">
                                        {/* Title */}
                                        <div>
                                            <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                                                Detected Title
                                            </Label>
                                            <p className="text-sm font-medium text-foreground mt-1">{analysis.title}</p>
                                        </div>

                                        {/* Stats */}
                                        <div className="grid grid-cols-3 gap-3">
                                            <div className="p-3 rounded-lg bg-muted/50">
                                                <p className="text-lg font-bold text-foreground">{analysis.blockCount}</p>
                                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Blocks</p>
                                            </div>
                                            <div className="p-3 rounded-lg bg-muted/50">
                                                <p className="text-lg font-bold text-foreground">{analysis.imageCount}</p>
                                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Images</p>
                                            </div>
                                            <div className="p-3 rounded-lg bg-muted/50">
                                                <p className="text-lg font-bold text-foreground">{analysis.linkCount}</p>
                                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Links</p>
                                            </div>
                                        </div>

                                        {/* Preview Text */}
                                        {analysis.previewText && (
                                            <div>
                                                <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                                                    Preview Text
                                                </Label>
                                                <p className="text-xs text-foreground bg-muted/50 p-2 rounded-lg mt-1">
                                                    {analysis.previewText}
                                                </p>
                                            </div>
                                        )}

                                        {/* Content Summary */}
                                        <div>
                                            <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                                                Content Map
                                            </Label>
                                            <pre className="text-xs text-foreground bg-muted/50 p-3 rounded-lg overflow-auto max-h-64 font-mono whitespace-pre-wrap mt-1">
                                                {analysis.summary}
                                            </pre>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-12 text-center">
                                        <FileText className="w-8 h-8 text-muted-foreground mb-3" />
                                        <p className="text-sm text-muted-foreground">
                                            Upload an HTML file to see the analysis
                                        </p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}
        </div>
    )
}
