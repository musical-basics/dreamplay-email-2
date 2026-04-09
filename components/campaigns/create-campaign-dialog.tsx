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

export function CreateCampaignDialog() {
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

            const result = await createCampaign(null, formData)

            if (result.error) {
                throw new Error(result.error)
            }

            toast({
                title: "Campaign created",
                description: `"${name}" has been created successfully.`,
            })

            // Redirect to editor
            if (result.data?.id) {
                setOpen(false)
                setName("")
                router.push(`/editor?id=${result.data.id}`)
            }
        } catch (error: any) {
            console.error("Error creating campaign:", error)
            toast({
                title: "Error",
                description: error.message || "Failed to create campaign",
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
                    New Campaign
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Create New Campaign</DialogTitle>
                    <DialogDescription>
                        Give your campaign a name to get started. You can change this later.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name">Campaign Name</Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g., Monthly Newsletter"
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
                        {loading ? "Creating..." : "Create Campaign"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
