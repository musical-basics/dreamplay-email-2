import type React from "react"

export default function EditorLayout({
    children,
}: {
    children: React.ReactNode
}) {
    // This layout renders only children without the main sidebar
    // to give the editor full screen real estate
    return <>{children}</>
}
