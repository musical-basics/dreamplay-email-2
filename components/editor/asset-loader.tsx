"use client"

import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import Link from "next/link"
import { useSearchParams, useParams } from "next/navigation"
import { Upload, ImageIcon, ArrowLeft, Bookmark } from "lucide-react"
import { AssetPickerModal } from "./asset-picker-modal"
import { getDefaultLinks, getCustomLinks, type DefaultLinks, type CustomLink } from "@/app/actions/settings"
import {
    STANDARD_TAGS,
    isImageVariable,
    isLinkVariable,
    isTextAreaVariable,
    isFitVariable,
    findPairedLinkVar,
    findPairedImageVar,
} from "@/lib/variable-rules"

interface AssetLoaderProps {
    variables: string[]
    assets: Record<string, string>
    onUpdateAsset: (key: string, value: string) => void
    showBackButton?: boolean
}

export function AssetLoader({ variables, assets, onUpdateAsset, showBackButton = true }: AssetLoaderProps) {
    const [activeVariable, setActiveVariable] = useState<string | null>(null)
    const [savedLinks, setSavedLinks] = useState<DefaultLinks | null>(null)
    const [customLinks, setCustomLinks] = useState<CustomLink[]>([])
    const searchParams = useSearchParams()
    const routeParams = useParams<{ workspace: string }>()
    const backWorkspace = routeParams?.workspace || searchParams.get("workspace") || ""

    useEffect(() => {
        Promise.all([
            getDefaultLinks("dreamplay"),
            getCustomLinks("dreamplay"),
        ]).then(([defaults, custom]) => {
            setSavedLinks(defaults)
            setCustomLinks(custom)

            // Auto-populate URL variables from saved default links
            // This ensures template variables like {{main_cta_url}} get a value
            // even when the user doesn't manually set them in the asset loader
            if (defaults) {
                for (const [key, url] of Object.entries(defaults)) {
                    if (url && typeof url === "string" && url.trim() !== "") {
                        // Only auto-fill if the variable exists in the template AND has no value yet
                        if (variables.includes(key) && !assets[key]) {
                            onUpdateAsset(key, url)
                        }
                    }
                }
            }
        })
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Build non-empty saved links for the dropdown (default + custom)
    const linkEntries = [
        ...(savedLinks
            ? Object.entries(savedLinks)
                .filter(([_, v]) => v && v.trim() !== "")
                .map(([key, url]) => ({ label: key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()), url }))
            : []),
        ...customLinks
            .filter(cl => cl.label && cl.url)
            .map(cl => ({ label: cl.label, url: cl.url })),
    ]


    const handleImageUpload = (variable: string) => {
        setActiveVariable(variable)
    }

    const handleAssetSelect = (url: string) => {
        if (activeVariable) {
            onUpdateAsset(activeVariable, url)
        }
    }

    // Build grouped variables: skip link vars that are paired with an image (they'll render inside the image card)
    const pairedLinkVars = new Set<string>()
    variables.forEach(v => {
        if (isImageVariable(v)) {
            const linkVar = findPairedLinkVar(v, variables)
            if (linkVar) pairedLinkVars.add(linkVar)
        }
    })

    // Also skip standalone _fit vars that are paired with images (they render inline)
    const pairedFitVars = new Set<string>()
    variables.forEach(v => {
        if (isImageVariable(v)) {
            const fitKey = `${v}_fit`
            if (variables.includes(fitKey)) pairedFitVars.add(fitKey)
        }
    })

    const displayVariables = variables.filter(v => 
        !pairedLinkVars.has(v) && 
        !pairedFitVars.has(v) && 
        !STANDARD_TAGS.includes(v.toLowerCase())
    )

    return (
        <aside className="w-full h-full flex flex-col bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
                {showBackButton && (
                    <Link href={backWorkspace ? `/${backWorkspace}` : "/"} className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        <ArrowLeft className="w-3 h-3" />
                        Back to Dashboard
                    </Link>
                )}
                <div className="flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-primary" />
                    <h2 className="text-sm font-semibold text-foreground">
                        Asset Loader
                    </h2>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Variables detected in your template</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {displayVariables.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No variables found. Add {"{{variable_name}}"} to your code.</p>
                ) : (
                    displayVariables.map((variable) => {
                        // ─── Image variable: render as a grouped card with optional link + fit ───
                        if (isImageVariable(variable)) {
                            const pairedLink = findPairedLinkVar(variable, variables)
                            return (
                                <div key={variable} className="rounded-lg border-l-4 border-l-primary/60 border border-border bg-muted/50 p-3 space-y-3">
                                    {/* Image source */}
                                    <div className="space-y-1.5">
                                        <Label htmlFor={variable} className="text-xs font-mono text-muted-foreground">
                                            {`{{${variable}}}`}
                                        </Label>
                                        <div className="flex gap-2">
                                            <Input
                                                id={variable}
                                                value={assets[variable] || ""}
                                                onChange={(e) => onUpdateAsset(variable, e.target.value)}
                                                placeholder={`Image URL`}
                                                className="flex-1 text-sm bg-muted border-border font-mono"
                                            />
                                            <Button
                                                variant="outline"
                                                size="icon"
                                                onClick={() => handleImageUpload(variable)}
                                                title="Upload/Select Image"
                                                className="flex-shrink-0"
                                            >
                                                <Upload className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Fit Control */}
                                    <div className="flex gap-2 items-center">
                                        <Label className="text-xs text-muted-foreground w-12">Fit:</Label>
                                        <Select
                                            value={assets[`${variable}_fit`] || "cover"}
                                            onValueChange={(value) => onUpdateAsset(`${variable}_fit`, value)}
                                        >
                                            <SelectTrigger className="h-8 text-xs">
                                                <SelectValue placeholder="Fit" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="cover">Cover</SelectItem>
                                                <SelectItem value="contain">Contain</SelectItem>
                                                <SelectItem value="fill">Fill</SelectItem>
                                                <SelectItem value="scale-down">Scale Down</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {/* Paired link URL */}
                                    {pairedLink && (
                                        <div className="space-y-1.5">
                                            <Label htmlFor={pairedLink} className="text-xs font-mono text-muted-foreground">
                                                {`{{${pairedLink}}}`}
                                            </Label>
                                            <div className="flex gap-1">
                                                <Input
                                                    id={pairedLink}
                                                    value={assets[pairedLink] || ""}
                                                    onChange={(e) => onUpdateAsset(pairedLink, e.target.value)}
                                                    placeholder="Link destination URL"
                                                    className="flex-1 text-sm bg-muted border-border font-mono"
                                                />
                                                {linkEntries.length > 0 && (
                                                    <Select onValueChange={(url) => onUpdateAsset(pairedLink, url)}>
                                                        <SelectTrigger className="w-9 h-9 p-0 flex-shrink-0" title="Insert saved link">
                                                            <Bookmark className="w-3.5 h-3.5" />
                                                        </SelectTrigger>
                                                        <SelectContent align="end">
                                                            {linkEntries.map(({ label, url }) => (
                                                                <SelectItem key={label} value={url}>
                                                                    <span className="text-xs">{label}</span>
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Image preview */}
                                    {assets[variable] && (
                                        <div className="rounded border border-border overflow-hidden bg-muted/50 flex items-center justify-center p-2">
                                            <img
                                                src={assets[variable]}
                                                alt={variable}
                                                className="max-w-full max-h-32 object-contain"
                                                style={{
                                                    objectFit: (assets[`${variable}_fit`] as any) || "cover",
                                                    width: '100%',
                                                    height: '100px'
                                                }}
                                                onError={(e) => {
                                                    e.currentTarget.style.display = "none"
                                                }}
                                            />
                                        </div>
                                    )}
                                </div>
                            )
                        }

                        // ─── Standalone link variable (not paired with any image) ───
                        if (isLinkVariable(variable)) {
                            return (
                                <div key={variable} className="space-y-2">
                                    <Label htmlFor={variable} className="text-xs font-mono text-muted-foreground">
                                        {`{{${variable}}}`}
                                    </Label>
                                    <div className="flex gap-1">
                                        <Input
                                            id={variable}
                                            value={assets[variable] || ""}
                                            onChange={(e) => onUpdateAsset(variable, e.target.value)}
                                            placeholder="Link destination URL"
                                            className="flex-1 text-sm bg-muted border-border font-mono"
                                        />
                                        {linkEntries.length > 0 && (
                                            <Select onValueChange={(url) => onUpdateAsset(variable, url)}>
                                                <SelectTrigger className="w-9 h-9 p-0 flex-shrink-0" title="Insert saved link">
                                                    <Bookmark className="w-3.5 h-3.5" />
                                                </SelectTrigger>
                                                <SelectContent align="end">
                                                    {linkEntries.map(({ label, url }) => (
                                                        <SelectItem key={label} value={url}>
                                                            <span className="text-xs">{label}</span>
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    </div>
                                </div>
                            )
                        }

                        // ─── Textarea variable ───
                        if (isTextAreaVariable(variable)) {
                            return (
                                <div key={variable} className="space-y-2">
                                    <Label htmlFor={variable} className="text-xs font-mono text-muted-foreground">
                                        {`{{${variable}}}`}
                                    </Label>
                                    <Textarea
                                        id={variable}
                                        value={assets[variable] || ""}
                                        onChange={(e) => onUpdateAsset(variable, e.target.value)}
                                        placeholder={`Enter ${variable}`}
                                        className="text-sm bg-muted border-border font-mono min-h-[100px] resize-y"
                                        rows={4}
                                    />
                                </div>
                            )
                        }

                        // ─── Fit variable (standalone, not paired) ───
                        if (isFitVariable(variable)) {
                            return (
                                <div key={variable} className="space-y-2">
                                    <Label htmlFor={variable} className="text-xs font-mono text-muted-foreground">
                                        {`{{${variable}}}`}
                                    </Label>
                                    <Select
                                        value={assets[variable] || "cover"}
                                        onValueChange={(value) => onUpdateAsset(variable, value)}
                                    >
                                        <SelectTrigger className="w-full">
                                            <SelectValue placeholder="Select fit" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="cover">Cover</SelectItem>
                                            <SelectItem value="contain">Contain</SelectItem>
                                            <SelectItem value="fill">Fill</SelectItem>
                                            <SelectItem value="scale-down">Scale Down</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )
                        }

                        // ─── Default: plain text input ───
                        return (
                            <div key={variable} className="space-y-2">
                                <Label htmlFor={variable} className="text-xs font-mono text-muted-foreground">
                                    {`{{${variable}}}`}
                                </Label>
                                <Input
                                    id={variable}
                                    value={assets[variable] || ""}
                                    onChange={(e) => onUpdateAsset(variable, e.target.value)}
                                    placeholder={`Enter ${variable}`}
                                    className="flex-1 text-sm bg-muted border-border font-mono"
                                />
                            </div>
                        )
                    })
                )}
            </div>

            <AssetPickerModal
                isOpen={!!activeVariable}
                onClose={() => setActiveVariable(null)}
                onSelect={handleAssetSelect}
            />
        </aside>
    )
}
