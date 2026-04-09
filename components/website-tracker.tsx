"use client"

import { useEffect, useRef, Suspense } from "react"
import { useSearchParams, usePathname } from "next/navigation"

function TrackerContent() {
    const searchParams = useSearchParams()
    const pathname = usePathname()
    const startTime = useRef(Date.now())

    // Check if user came from an email
    const sid = searchParams.get("sid")
    const cid = searchParams.get("cid")

    useEffect(() => {
        if (!sid) return

        // 1. Log Page View immediately
        // Note: Replace this with your actual tracking engine URL if it's different
        const baseUrl = "https://email.dreamplaypianos.com"

        const trackPage = async () => {
            try {
                await fetch(`${baseUrl}/api/track`, {
                    method: "POST",
                    body: JSON.stringify({
                        subscriber_id: sid,
                        campaign_id: cid,
                        type: "page_view",
                        url: window.location.href
                    })
                })
            } catch (e) {
                console.error("Failed to track page view", e)
            }
        }

        trackPage()

        // 2. Track Duration on unmount/tab close
        const logDuration = () => {
            const duration = Math.floor((Date.now() - startTime.current) / 1000)
            if (duration > 1) { // Only log if > 1 second
                // Use navigator.sendBeacon for reliability during unload
                const data = JSON.stringify({
                    subscriber_id: sid,
                    campaign_id: cid,
                    type: "session_end",
                    duration: duration,
                    url: window.location.href
                })
                navigator.sendBeacon(`${baseUrl}/api/track`, data)
            }
        }

        window.addEventListener("beforeunload", logDuration)

        return () => {
            logDuration()
            window.removeEventListener("beforeunload", logDuration)
        }
    }, [pathname, sid, cid])

    return null
}

export function WebsiteTracker() {
    return (
        <Suspense fallback={null}>
            <TrackerContent />
        </Suspense>
    )
}
