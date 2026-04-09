import { ShieldCheck, CheckCircle2, AlertCircle, XCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

interface CheckItem {
    label: string
    status: "pass" | "warning" | "fail"
    detail?: string
}

interface PreflightCheckCardProps {
    subjectLine: string | null
    previewText: string | null
}

export function PreflightCheckCard({ subjectLine, previewText }: PreflightCheckCardProps) {
    const safeSubject = subjectLine || ""
    const safePreview = previewText || ""

    // Build checklist items
    const checks: CheckItem[] = [
        {
            label: "Subject Line",
            status: safeSubject && safeSubject.trim().length > 0 ? "pass" : "fail",
            detail: safeSubject ? "Present" : "Missing",
        },
        {
            label: "Preview Text",
            status: safePreview && safePreview.trim().length > 0 ? "pass" : "fail",
            detail: safePreview ? "Present" : "Missing",
        },
    ]

    const getStatusIcon = (status: CheckItem["status"]) => {
        switch (status) {
            case "pass":
                return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            case "warning":
                return <AlertCircle className="h-4 w-4 text-amber-500" />
            case "fail":
                return <XCircle className="h-4 w-4 text-red-500" />
        }
    }

    const allPassed = checks.every((c) => c.status === "pass")
    const hasFailures = checks.some((c) => c.status === "fail")

    return (
        <Card className="border-border bg-card">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-medium text-foreground">
                    <ShieldCheck className="h-5 w-5 text-[#D4AF37]" />
                    Pre-Flight Check
                    {allPassed && (
                        <span className="ml-auto rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500">
                            All Clear
                        </span>
                    )}
                    {hasFailures && (
                        <span className="ml-auto rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-500">
                            Issues Found
                        </span>
                    )}
                </CardTitle>
                <CardDescription className="text-muted-foreground">System check to ensure nothing is broken.</CardDescription>
            </CardHeader>
            <CardContent>
                <ul className="space-y-3">
                    {checks.map((check, index) => (
                        <li key={index} className="flex items-start gap-3">
                            <span className="mt-0.5">{getStatusIcon(check.status)}</span>
                            <div className="flex flex-col">
                                <span className="text-sm font-medium text-foreground">{check.label}</span>
                                {check.detail && <span className="text-xs text-muted-foreground">{check.detail}</span>}
                            </div>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    )
}
