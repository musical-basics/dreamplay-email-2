"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { KnowledgeEmailEditor } from "@/components/editor/knowledge-email-editor"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { saveCampaignBackup } from "@/app/actions/campaigns"
import { getCampaignDossier } from "@/app/actions/audience-intelligence"
import { DEFAULT_WORKSPACE } from "@/lib/workspace"

const DEFAULT_HTML = `<div><img src="{{hero_src}}" class="w-full" /> <h1>{{headline}}</h1></div>`
const DEFAULT_ASSETS = {
    hero_src: "https://via.placeholder.com/600x200",
    headline: "Welcome to the Tournament",
}

function EditorV2Content() {
    const searchParams = useSearchParams()
    const router = useRouter()
    const { toast } = useToast()
    const supabase = createClient()
    const id = searchParams.get("id")

    const [html, setHtml] = useState(DEFAULT_HTML)
    const [assets, setAssets] = useState<Record<string, string>>(DEFAULT_ASSETS)
    const [name, setName] = useState("Untitled Campaign")
    const [status, setStatus] = useState("draft")

    const [subjectLine, setSubjectLine] = useState("")
    const [fromName, setFromName] = useState("Lionel Yu")
    const [fromEmail, setFromEmail] = useState("lionel@email.dreamplaypianos.com")
    const [audienceContext, setAudienceContext] = useState<"dreamplay" | "musicalbasics" | "both">("dreamplay")
    const [emailType, setEmailType] = useState<"campaign" | "automated">("campaign")
    const [aiDossier, setAiDossier] = useState("")

    const [loading, setLoading] = useState(!!id)
    const [saving, setSaving] = useState(false)

    const [saveDialogOpen, setSaveDialogOpen] = useState(false)
    const [nameInput, setNameInput] = useState("")

    useEffect(() => {
        if (!id) return

        const fetchCampaign = async () => {
            setLoading(true)
            const { data, error } = await supabase
                .from("campaigns")
                .select("*")
                .eq("id", id)
                .single()

            if (data) {
                setHtml(data.html_content || DEFAULT_HTML)
                setAssets(data.variable_values || DEFAULT_ASSETS)
                setName(data.name || "Untitled Campaign")
                setStatus(data.status || "draft")
                setEmailType(data.email_type || "campaign")

                setSubjectLine(data.subject_line || "")
                if (data.variable_values?.from_name) setFromName(data.variable_values.from_name)
                if (data.variable_values?.from_email) setFromEmail(data.variable_values.from_email)
                if (data.variable_values?.audience_context) setAudienceContext(data.variable_values.audience_context)

                getCampaignDossier(data.id, DEFAULT_WORKSPACE).then(d => setAiDossier(d))
            }
            setLoading(false)
        }

        fetchCampaign()
    }, [id, supabase, toast])

    const executeSave = async (campaignName: string) => {
        setSaving(true)
        const campaignData = {
            name: campaignName,
            subject_line: subjectLine,
            html_content: html,
            variable_values: {
                ...assets,
                from_name: fromName,
                from_email: fromEmail,
                audience_context: audienceContext
            },
            status: status,
            email_type: emailType,
        }

        let error
        let newId = id

        if (id) {
            const { error: updateError } = await supabase
                .from("campaigns")
                .update(campaignData)
                .eq("id", id)
            error = updateError
        } else {
            const { data, error: insertError } = await supabase
                .from("campaigns")
                .insert([campaignData])
                .select()
                .single()

            error = insertError
            if (data) newId = data.id
        }

        if (error) {
            toast({
                title: "Error saving campaign",
                description: error.message,
                variant: "destructive",
            })
        } else {
            setName(campaignName)
            toast({
                title: "Campaign saved",
                description: "Your changes have been saved successfully.",
            })

            const savedId = id || newId
            if (savedId) {
                await saveCampaignBackup(
                    savedId,
                    html,
                    { ...assets, from_name: fromName, from_email: fromEmail },
                    subjectLine
                )
            }

            if (!id && newId) {
                router.replace(`/editor-v2?id=${newId}`)
            }
        }
        setSaving(false)
        setSaveDialogOpen(false)
    }

    const handleSaveClick = () => {
        if (name === "Untitled Campaign") {
            setNameInput(name)
            setSaveDialogOpen(true)
        } else {
            executeSave(name)
        }
    }

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-background text-foreground">
                <p>Loading campaign...</p>
            </div>
        )
    }

    return (
        <main className="h-screen w-screen">
            <KnowledgeEmailEditor
                html={html}
                assets={assets}
                subjectLine={subjectLine}
                fromName={fromName}
                fromEmail={fromEmail}
                audienceContext={audienceContext}
                emailType={emailType}
                aiDossier={aiDossier}
                onHtmlChange={setHtml}
                onAssetsChange={setAssets}
                onSubjectChange={setSubjectLine}
                onSenderChange={(field, value) => {
                    if (field === "name") setFromName(value)
                    if (field === "email") setFromEmail(value)
                }}
                onAudienceChange={setAudienceContext}
                onEmailTypeChange={setEmailType}
                campaignName={name}
                onNameChange={setName}
                onSave={handleSaveClick}
                campaignId={id}
                onRestore={(backup) => {
                    setHtml(backup.html_content || DEFAULT_HTML)
                    setAssets(backup.variable_values || DEFAULT_ASSETS)
                    setSubjectLine(backup.subject_line || "")
                    if (backup.variable_values?.from_name) setFromName(backup.variable_values.from_name)
                    if (backup.variable_values?.from_email) setFromEmail(backup.variable_values.from_email)
                    toast({ title: "Version restored", description: "Campaign reverted to saved version." })
                }}
            />

            <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Save Campaign</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="name">Campaign Name</Label>
                            <Input
                                id="name"
                                value={nameInput}
                                onChange={(e) => setNameInput(e.target.value)}
                                placeholder="Enter campaign name"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
                        <Button onClick={() => executeSave(nameInput)} disabled={saving}>
                            {saving ? "Saving..." : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </main>
    )
}

export default function EditorV2Page() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center">Loading...</div>}>
            <EditorV2Content />
        </Suspense>
    )
}
