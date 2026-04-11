"use client"

import { useState } from "react"
import { unsubscribeUser, unsubscribeFromAll } from "@/app/actions/unsubscribe"
import { Loader2, CheckCircle2, Mail, MailX } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Props {
    subscriberId: string
    campaignId?: string
    email?: string
    workspaceLabel?: string
}

type Choice = "workspace" | "all"
type Status = "idle" | "loading" | "success" | "error"

export function UnsubscribeConfirm({ subscriberId, campaignId, email, workspaceLabel }: Props) {
    const [status, setStatus] = useState<Status>("idle")
    const [choice, setChoice] = useState<Choice | null>(null)

    const handleUnsubscribe = async (selected: Choice) => {
        setChoice(selected)
        setStatus("loading")
        try {
            let result
            if (selected === "all" && email) {
                result = await unsubscribeFromAll(email, campaignId)
            } else {
                result = await unsubscribeUser(subscriberId, campaignId)
            }
            setStatus(result.success ? "success" : "error")
        } catch {
            setStatus("error")
        }
    }

    if (status === "success") {
        return (
            <div className="text-center">
                <div className="mx-auto w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mb-5">
                    <CheckCircle2 className="w-7 h-7 text-green-600" />
                </div>
                <h1 className="text-xl font-semibold text-gray-900 mb-2">You've been unsubscribed</h1>
                <p className="text-gray-500 text-sm leading-relaxed">
                    {choice === "all"
                        ? "You've been removed from all our email lists. You won't receive any further emails from us."
                        : `You've been removed from ${workspaceLabel ? `the ${workspaceLabel} list` : "this email list"}. You may still receive emails from our other lists.`}
                </p>
            </div>
        )
    }

    if (status === "error") {
        return (
            <div className="text-center">
                <div className="mx-auto w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mb-5">
                    <MailX className="w-7 h-7 text-red-600" />
                </div>
                <h1 className="text-xl font-semibold text-gray-900 mb-2">Something went wrong</h1>
                <p className="text-gray-500 text-sm mb-5">We couldn't process your request. Please try again.</p>
                <Button onClick={() => { setStatus("idle"); setChoice(null) }} variant="outline">
                    Try Again
                </Button>
            </div>
        )
    }

    const isLoading = status === "loading"

    return (
        <div className="text-center">
            <div className="mx-auto w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mb-5">
                <Mail className="w-7 h-7 text-gray-500" />
            </div>

            <h1 className="text-xl font-semibold text-gray-900 mb-2">Manage your email preferences</h1>

            {workspaceLabel && (
                <p className="text-sm text-gray-500 mb-7">
                    You received this email from <span className="font-medium text-gray-700">{workspaceLabel}</span>.
                </p>
            )}
            {!workspaceLabel && (
                <p className="text-sm text-gray-500 mb-7">How would you like to unsubscribe?</p>
            )}

            <div className={`grid gap-3 mb-6 ${email ? "grid-cols-2" : "grid-cols-1"}`}>
                {/* Option 1 — workspace-specific */}
                <button
                    onClick={() => handleUnsubscribe("workspace")}
                    disabled={isLoading}
                    className="flex flex-col items-center gap-2 rounded-xl border-2 border-gray-200 hover:border-gray-400 p-5 text-left transition-all hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                    {isLoading && choice === "workspace"
                        ? <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
                        : <Mail className="w-6 h-6 text-gray-400 group-hover:text-gray-600 transition-colors" />
                    }
                    <div>
                        <p className="text-sm font-semibold text-gray-800">
                            {workspaceLabel ? `Unsubscribe from ${workspaceLabel}` : "Unsubscribe from this list"}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5 leading-snug">
                            {workspaceLabel
                                ? `You'll still receive emails from our other lists`
                                : `Remove me from this email list only`}
                        </p>
                    </div>
                </button>

                {/* Option 2 — unsubscribe from all (only shown if email is available) */}
                {email && (
                    <button
                        onClick={() => handleUnsubscribe("all")}
                        disabled={isLoading}
                        className="flex flex-col items-center gap-2 rounded-xl border-2 border-gray-200 hover:border-red-300 p-5 text-left transition-all hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed group"
                    >
                        {isLoading && choice === "all"
                            ? <Loader2 className="w-6 h-6 text-red-400 animate-spin" />
                            : <MailX className="w-6 h-6 text-gray-400 group-hover:text-red-500 transition-colors" />
                        }
                        <div>
                            <p className="text-sm font-semibold text-gray-800">Unsubscribe from all emails</p>
                            <p className="text-xs text-gray-400 mt-0.5 leading-snug">
                                Remove me from every list — DreamPlay, Musical Basics, and all others
                            </p>
                        </div>
                    </button>
                )}
            </div>

            <a
                href="/"
                className="text-xs text-gray-400 hover:text-gray-600 hover:underline transition-colors"
            >
                Keep me subscribed
            </a>
        </div>
    )
}
