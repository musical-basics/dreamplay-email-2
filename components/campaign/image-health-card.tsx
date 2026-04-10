"use client"

import { useEffect, useState } from "react"
import { ImageIcon, AlertTriangle, CheckCircle2, Loader2, ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"

interface ImageInfo {
  url: string
  sizeBytes: number | null
  status: "ok" | "warn" | "error" | "loading" | "supabase"
  label: string
}

const WARN_BYTES     = 3 * 1024 * 1024   // 3 MB
const OPTIMIZE_BYTES = 5 * 1024 * 1024   // 5 MB

function isSupabase(url: string) {
  try {
    const { hostname } = new URL(url)
    return hostname.includes(".supabase.co") || hostname.includes(".supabase.in")
  } catch { return false }
}

function extractImageUrls(html: string): string[] {
  const regex = /src=["'](https?:\/\/[^"']+)['"]/gi
  const urls: string[] = []
  let match
  while ((match = regex.exec(html)) !== null) {
    urls.push(match[1])
  }
  return [...new Set(urls)]
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "unknown size"
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  return `${Math.round(bytes / 1024)}KB`
}

interface Props {
  htmlContent: string | null
}

export function ImageHealthCard({ htmlContent }: Props) {
  const [images, setImages] = useState<ImageInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!htmlContent) { setLoading(false); return }

    const urls = extractImageUrls(htmlContent)
    if (urls.length === 0) { setLoading(false); return }

    // Initialize with loading state
    setImages(urls.map(url => ({
      url,
      sizeBytes: null,
      status: isSupabase(url) ? "supabase" : "loading",
      label: isSupabase(url) ? "Proxied ✓" : "Checking...",
    })))

    // HEAD-check each non-supabase URL
    Promise.all(
      urls.map(async (url) => {
        if (isSupabase(url)) {
          return { url, sizeBytes: null, status: "supabase" as const, label: "Proxied (Supabase)" }
        }
        try {
          const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(6_000) })
          if (!res.ok) {
            return { url, sizeBytes: null, status: "error" as const, label: `HTTP ${res.status}` }
          }
          const cl = res.headers.get("content-length")
          const bytes = cl ? parseInt(cl, 10) : null

          if (bytes !== null && bytes > OPTIMIZE_BYTES) {
            return {
              url, sizeBytes: bytes,
              status: "error" as const,
              label: `${formatBytes(bytes)} — will be auto-optimized at send time`,
            }
          }
          if (bytes !== null && bytes > WARN_BYTES) {
            return {
              url, sizeBytes: bytes,
              status: "warn" as const,
              label: `${formatBytes(bytes)} — large, may be slow`,
            }
          }
          return {
            url, sizeBytes: bytes,
            status: "ok" as const,
            label: formatBytes(bytes),
          }
        } catch {
          return { url, sizeBytes: null, status: "warn" as const, label: "Could not check (CORS)" }
        }
      })
    ).then((results) => {
      setImages(results)
      setLoading(false)
    })
  }, [htmlContent])

  if (!htmlContent) return null

  const urls = extractImageUrls(htmlContent)
  if (urls.length === 0) return null

  const errorCount = images.filter(i => i.status === "error").length
  const warnCount  = images.filter(i => i.status === "warn").length
  const okCount    = images.filter(i => i.status === "ok" || i.status === "supabase").length

  const overallStatus = errorCount > 0 ? "error" : warnCount > 0 ? "warn" : "ok"

  return (
    <div className={`rounded-xl border bg-card p-4 space-y-3 ${
      overallStatus === "error"
        ? "border-orange-500/30"
        : overallStatus === "warn"
          ? "border-amber-500/30"
          : "border-border"
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">Image Health</p>
        </div>
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex gap-1.5 items-center">
            {errorCount > 0 && (
              <Badge className="bg-orange-500/10 text-orange-400 border-orange-500/30 text-[10px]">
                {errorCount} oversized
              </Badge>
            )}
            {warnCount > 0 && (
              <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px]">
                {warnCount} large
              </Badge>
            )}
            {okCount > 0 && (
              <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">
                {okCount} ok
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Summary banner for oversized images */}
      {!loading && errorCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg bg-orange-500/10 border border-orange-500/20 px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 text-orange-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-orange-400">
            {errorCount} image{errorCount > 1 ? "s are" : " is"} over 5MB and will be automatically
            resized to 1200px JPEG when this campaign is sent. For best results, pre-optimize
            source assets to &lt;2MB.
          </p>
        </div>
      )}

      {/* Image list */}
      <div className="space-y-1.5">
        {images.map((img, i) => {
          const filename = (() => {
            try { return decodeURIComponent(new URL(img.url).pathname.split("/").pop() || "image") }
            catch { return "image" }
          })()

          const statusIcon = img.status === "loading"
            ? <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
            : img.status === "supabase" || img.status === "ok"
              ? <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
              : img.status === "warn"
                ? <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />
                : <AlertTriangle className="w-3 h-3 text-orange-400 flex-shrink-0" />

          return (
            <div
              key={i}
              className={`flex items-start justify-between gap-2 rounded-md px-2.5 py-2 text-xs ${
                img.status === "error"
                  ? "bg-orange-500/5 border border-orange-500/15"
                  : img.status === "warn"
                    ? "bg-amber-500/5 border border-amber-500/15"
                    : "bg-muted/30 border border-border/50"
              }`}
            >
              <div className="flex items-start gap-1.5 min-w-0">
                {statusIcon}
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate" title={filename}>{filename}</p>
                  <p className={`text-[10px] mt-0.5 ${
                    img.status === "error" ? "text-orange-400"
                      : img.status === "warn" ? "text-amber-400"
                        : "text-muted-foreground"
                  }`}>{img.label}</p>
                </div>
              </div>
              <a
                href={img.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mt-0.5"
                title="Open image"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )
        })}
      </div>

      {!loading && overallStatus === "ok" && (
        <p className="text-[10px] text-muted-foreground">All images are email-safe.</p>
      )}
    </div>
  )
}
