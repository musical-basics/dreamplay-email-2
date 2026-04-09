"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { createCampaign } from "@/app/actions/campaigns"

export function CreateAutomatedDialog() {
    const [open, setOpen] = useState(false)
    const [name, setName] = useState("")
    const [loading, setLoading] = useState(false)
    const router = useRouter()
    const { toast } = useToast()

    const handleCreate = async () => {
        if (!name.trim()) return

        setLoading(true)
        try {
            const formData = new FormData()
            formData.append("name", name)
            formData.append("email_type", "automated")

            const result = await createCampaign(null, formData)

            if (result.error) {
                throw new Error(result.error)
            }

            toast({
                title: "Automated email created",
                description: `"${name}" has been created successfully.`,
            })

            // Redirect to editor
            if (result.data?.id) {
                setOpen(false)
                setName("")
                router.push(`/editor?id=${result.data.id}`)
            }
        } catch (error: any) {
            console.error("Error creating automated email:", error)
            toast({
                title: "Error",
                description: error.message || "Failed to create automated email",
                variant: "destructive",
            })
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                    <Plus className="mr-2 h-4 w-4" />
                    New Automated Email
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Create Automated Email</DialogTitle>
                    <DialogDescription>
                        Create a new automated email template. These are triggered automatically when subscribers perform specific actions.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name">Email Name</Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g., $300 Off Welcome Email"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !loading && name.trim()) {
                                    handleCreate()
                                }
                            }}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleCreate} disabled={!name.trim() || loading}>
                        {loading ? "Creating..." : "Create Email"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
