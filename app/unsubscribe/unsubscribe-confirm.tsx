"use client"

import { useState } from "react"
import { unsubscribeUser } from "@/app/actions/unsubscribe"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

export function UnsubscribeConfirm({ subscriberId, campaignId }: { subscriberId: string; campaignId?: string }) {
    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle")

    const handleUnsubscribe = async () => {
        setStatus("loading")
        try {
            const result = await unsubscribeUser(subscriberId, campaignId)
            if (result.success) {
                setStatus("success")
            } else {
                setStatus("error")
            }
        } catch (error) {
            setStatus("error")
        }
    }

    if (status === "success") {
        return (
            <div className="text-center">
                <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                </div>
                <h1 className="text-xl font-semibold text-gray-900 mb-2">Unsubscribed Successfully</h1>
                <p className="text-gray-600 mb-6">
                    You have been removed from our mailing list. You won't receive any further emails from us.
                </p>
                <a href="/" className="text-sm text-blue-600 hover:underline">
                    Return to homepage
                </a>
            </div>
        )
    }

    if (status === "error") {
        return (
            <div className="text-center">
                <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </div>
                <h1 className="text-xl font-semibold text-gray-900 mb-2">Something went wrong</h1>
                <p className="text-gray-600 mb-6">
                    We couldn't unsubscribe you at this moment. Please try again later.
                </p>
                <Button onClick={handleUnsubscribe} variant="outline">
                    Try Again
                </Button>
            </div>
        )
    }

    return (
        <div className="text-center">
            <h1 className="text-xl font-semibold text-gray-900 mb-2">Confirm Unsubscribe</h1>
            <p className="text-gray-600 mb-6">
                Are you sure you want to stop receiving these emails?
            </p>
            <Button
                onClick={handleUnsubscribe}
                className="bg-red-600 hover:bg-red-700 text-white w-full sm:w-auto"
                disabled={status === "loading"}
            >
                {status === "loading" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Yes, Unsubscribe Me
            </Button>
        </div>
    )
}
