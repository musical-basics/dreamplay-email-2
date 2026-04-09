import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Plus, Upload } from "lucide-react"

export function QuickActions() {
    return (
        <div className="flex flex-wrap gap-4">
            <Button asChild size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Link href="/editor">
                    <Plus className="mr-2 h-5 w-5" />
                    Create New Campaign
                </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
                <Link href="/audience">
                    <Upload className="mr-2 h-5 w-5" />
                    Import Audience
                </Link>
            </Button>
        </div>
    )
}
