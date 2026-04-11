"use client"

import { useMemo } from "react"
import { ImageIcon, CheckCircle2, Clock, ExternalLink } from "lucide-react"

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
  while ((match = regex.exec(html)) !== null) urls.push(match[1])
  return [...new Set(urls)]
}

interface Props {
  htmlContent: string | null
}

export function ImageHealthCard({ htmlContent }: Props) {
  const images = useMemo(() => {
    if (!htmlContent) return []
    return extractImageUrls(htmlContent).map(url => ({
      url,
      proxied: isSupabase(url),
      filename: (() => {
        try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || "image") }
        catch { return "image" }
      })(),
    }))
  }, [htmlContent])

  if (images.length === 0) return null

  const proxiedCount = images.filter(i => i.proxied).length
  const externalCount = images.filter(i => !i.proxied).length

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">Image Health</p>
        </div>
        <div className="flex gap-1.5 items-center text-[10px] text-muted-foreground">
          {proxiedCount > 0 && <span className="text-emerald-400">{proxiedCount} proxied</span>}
          {proxiedCount > 0 && externalCount > 0 && <span>·</span>}
          {externalCount > 0 && <span className="text-sky-400">{externalCount} will be proxied at send</span>}
        </div>
      </div>

      {/* Info banner for external images */}
      {externalCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg bg-sky-500/10 border border-sky-500/20 px-3 py-2">
          <Clock className="w-3.5 h-3.5 text-sky-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-sky-400">
            {externalCount} external image{externalCount > 1 ? "s" : ""} will be automatically
            downloaded and stored on our CDN when you send. Images over 150 KB will be
            recompressed to email-safe JPEG at 1200px.
          </p>
        </div>
      )}

      {/* Image list */}
      <div className="space-y-1.5">
        {images.map((img, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-2 rounded-md px-2.5 py-2 bg-muted/30 border border-border/50"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              {img.proxied
                ? <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                : <Clock className="w-3 h-3 text-sky-400 flex-shrink-0" />
              }
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground truncate" title={img.filename}>
                  {img.filename}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {img.proxied ? "On Supabase CDN" : "External — will proxy at send"}
                </p>
              </div>
            </div>
            <a
              href={img.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        ))}
      </div>

      {externalCount === 0 && (
        <p className="text-[10px] text-muted-foreground">All images are already on permanent CDN.</p>
      )}
    </div>
  )
}
