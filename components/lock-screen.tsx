"use client"

import { useState, useEffect } from "react"
import { Lock, Eye, EyeOff } from "lucide-react"

const STORAGE_KEY = "mb_dashboard_unlocked"
const PASSWORD = "sorenkier"

export function LockScreen({ children }: { children: React.ReactNode }) {
    const [unlocked, setUnlocked] = useState<boolean | null>(null) // null = loading
    const [password, setPassword] = useState("")
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState(false)
    const [shake, setShake] = useState(false)

    useEffect(() => {
        setUnlocked(localStorage.getItem(STORAGE_KEY) === "true")
    }, [])

    const handleUnlock = (e: React.FormEvent) => {
        e.preventDefault()
        if (password === PASSWORD) {
            localStorage.setItem(STORAGE_KEY, "true")
            setUnlocked(true)
            setError(false)
        } else {
            setError(true)
            setShake(true)
            setTimeout(() => setShake(false), 500)
        }
    }

    // Loading state — prevent flash
    if (unlocked === null) {
        return <div className="min-h-screen bg-background" />
    }

    if (unlocked) {
        return <>{children}</>
    }

    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
            <div
                className={`w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-2xl transition-transform ${shake ? "animate-shake" : ""}`}
            >
                {/* Lock Icon */}
                <div className="flex justify-center mb-6">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 border border-amber-500/20">
                        <Lock className="h-6 w-6 text-amber-500" />
                    </div>
                </div>

                {/* Title */}
                <h1 className="text-xl font-bold text-center text-foreground mb-1">
                    Musical Basics
                </h1>
                <p className="text-sm text-muted-foreground text-center mb-6">
                    Enter password to continue
                </p>

                {/* Form */}
                <form onSubmit={handleUnlock} className="space-y-4">
                    <div className="relative">
                        <input
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => {
                                setPassword(e.target.value)
                                setError(false)
                            }}
                            placeholder="Password"
                            autoFocus
                            className={`w-full rounded-lg border bg-background px-4 py-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 transition-colors ${error
                                    ? "border-red-500 focus:ring-red-500/30"
                                    : "border-border focus:ring-amber-500/30"
                                }`}
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                    </div>

                    {error && (
                        <p className="text-xs text-red-400 text-center">
                            Incorrect password. Try again.
                        </p>
                    )}

                    <button
                        type="submit"
                        className="w-full rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-zinc-900 hover:bg-amber-400 transition-colors"
                    >
                        Unlock Dashboard
                    </button>
                </form>
            </div>

            {/* Shake animation */}
            <style jsx>{`
                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    20%, 60% { transform: translateX(-8px); }
                    40%, 80% { transform: translateX(8px); }
                }
                .animate-shake {
                    animation: shake 0.4s ease-in-out;
                }
            `}</style>
        </div>
    )
}
