"use client"

import { useState, useEffect, useRef } from "react"
import { Check, Link2 } from "lucide-react"

interface DiscountLinkPickerProps {
    /** The generated discount code */
    discountCode: string
    /** All current asset/variable values */
    assets: Record<string, any>
    /** Called when the user applies the discount to selected URLs */
    onApply: (updatedAssets: Record<string, any>) => void
    /** Called when the picker is dismissed */
    onClose: () => void
}

/**
 * After a discount code is generated, this component shows a small popover
 * listing all URL-like asset variables. The user can check which ones
 * should have ?discount=CODE appended.
 */
export function DiscountLinkPicker({ discountCode, assets, onApply, onClose }: DiscountLinkPickerProps) {
    const ref = useRef<HTMLDivElement>(null)

    // Find all URL-like variables (contain http, .com, or have url/link/cta in the key name)
    const urlEntries = Object.entries(assets).filter(([key, value]) => {
        if (typeof value !== "string") return false
        const keyLower = key.toLowerCase()
        const valueLower = value.toLowerCase()
        // Exclude non-URL keys
        if (keyLower.includes("discount_code") || keyLower.includes("preset")) return false
        // Include if the value looks like a URL
        if (valueLower.startsWith("http") || valueLower.includes(".com") || valueLower.includes(".io")) return true
        // Or if the key name suggests it's a link
        if (keyLower.includes("url") || keyLower.includes("link") || keyLower.includes("cta") || keyLower.includes("href")) return true
        return false
    })

    // Pre-select URLs that contain "cta" or "main" in their key name
    const [selected, setSelected] = useState<Set<string>>(() => {
        const initial = new Set<string>()
        urlEntries.forEach(([key]) => {
            const k = key.toLowerCase()
            if (k.includes("cta") || k.includes("main")) {
                initial.add(key)
            }
        })
        return initial
    })

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose()
            }
        }
        document.addEventListener("mousedown", handler)
        return () => document.removeEventListener("mousedown", handler)
    }, [onClose])

    const toggle = (key: string) => {
        setSelected(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    const handleApply = () => {
        const updated = { ...assets }
        selected.forEach(key => {
            const url = updated[key]
            if (typeof url !== "string") return
            if (url.includes("discount=")) {
                // Replace existing discount param
                updated[key] = url.replace(/discount=[^&]+/, `discount=${discountCode}`)
            } else {
                const sep = url.includes("?") ? "&" : "?"
                updated[key] = `${url}${sep}discount=${discountCode}`
            }
        })
        onApply(updated)
        onClose()
    }

    if (urlEntries.length === 0) {
        onClose()
        return null
    }

    return (
        <div ref={ref} className="absolute top-full left-0 mt-1 w-80 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
            <div className="px-3 py-2 border-b border-border bg-muted/30">
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5" />
                    Apply <code className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">{discountCode}</code> to links
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Select which URLs should include the discount</p>
            </div>
            <div className="max-h-48 overflow-y-auto py-1">
                {urlEntries.map(([key, value]) => {
                    const isChecked = selected.has(key)
                    const displayUrl = typeof value === "string" && value.length > 35
                        ? value.substring(0, 35) + "…"
                        : value
                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={() => toggle(key)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
                        >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${isChecked ? "bg-emerald-500 border-emerald-500" : "border-muted-foreground/30"}`}>
                                {isChecked && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium text-foreground font-mono truncate">
                                    {"{{" + key + "}}"}
                                </p>
                                <p className="text-[10px] text-muted-foreground truncate">{displayUrl}</p>
                            </div>
                        </button>
                    )
                })}
            </div>
            <div className="px-3 py-2 border-t border-border flex items-center justify-between">
                <button
                    type="button"
                    onClick={onClose}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                    Skip
                </button>
                <button
                    type="button"
                    onClick={handleApply}
                    disabled={selected.size === 0}
                    className="text-xs font-semibold bg-emerald-500 text-white px-3 py-1.5 rounded hover:bg-emerald-600 transition-colors disabled:opacity-40"
                >
                    Apply to {selected.size} link{selected.size !== 1 ? "s" : ""}
                </button>
            </div>
        </div>
    )
}
