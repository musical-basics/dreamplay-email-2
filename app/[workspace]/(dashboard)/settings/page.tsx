"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Save, Brain, Loader2, Link2, Bot, Zap, Flame, Cpu, MousePointerClick, Eye, Plus, Trash2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { getAnthropicModels } from "@/app/actions/ai-models"
import {
    getCompanyContext, saveCompanyContext,
    getDefaultLinks, saveDefaultLinks,
    getCustomLinks, saveCustomLinks,
    getAllTrackingSettings, saveTrackingSettings,
    type DefaultLinks, type AudienceContext, type Brand, type CustomLink, type TrackingFlags
} from "@/app/actions/settings"

const LINK_LABELS: Record<keyof DefaultLinks, string> = {
    unsubscribe_url: "Unsubscribe URL",
    privacy_url: "Privacy Policy",
    contact_url: "Contact Us",
    about_url: "About Page",
    shipping_url: "Shipping Info",
    main_cta_url: "Main CTA URL",
    main_activate_url: "Activate URL ($30 Off)",
    crowdfunding_cta_url: "Crowdfunding CTA",
    homepage_url: "Homepage URL",
}


// Map workspace slugs → settings keys
const WORKSPACE_TO_AUDIENCE: Record<string, string> = {
    dreamplay_marketing: "dreamplay",
    dreamplay_support: "dreamplay",
    musicalbasics: "musicalbasics",
    crossover: "crossover",
    concert_marketing: "concert_marketing",
}
const WORKSPACE_TO_BRAND: Record<string, string> = {
    dreamplay_marketing: "dreamplay",
    dreamplay_support: "dreamplay",
    musicalbasics: "musicalbasics",
    crossover: "musicalbasics",
    concert_marketing: "concert_marketing",
}
const WORKSPACE_LABELS: Record<string, string> = {
    dreamplay_marketing: "DreamPlay Marketing",
    dreamplay_support: "DreamPlay Support",
    musicalbasics: "MusicalBasics",
    crossover: "Crossover",
    concert_marketing: "Concert Marketing",
}

export default function SettingsPage() {
    const { workspace } = useParams<{ workspace: string }>()
    const audience = WORKSPACE_TO_AUDIENCE[workspace] || "dreamplay"
    const brand = WORKSPACE_TO_BRAND[workspace] || "dreamplay"
    const wsLabel = WORKSPACE_LABELS[workspace] || workspace

    // ─── Context State ──────────────────────────────
    const [context, setContext] = useState("")

    // ─── Links State ────────────────────────────────
    const [links, setLinks] = useState<DefaultLinks>({
        unsubscribe_url: "", privacy_url: "", contact_url: "", about_url: "",
        shipping_url: "", main_cta_url: "", main_activate_url: "", crowdfunding_cta_url: "", homepage_url: ""
    })

    const [loading, setLoading] = useState(true)
    const [savingContext, setSavingContext] = useState(false)
    const [savingLinks, setSavingLinks] = useState(false)

    // ─── Custom Links State ──────────────────────────
    const [customLinks, setCustomLinks] = useState<CustomLink[]>([])
    const [savingCustomLinks, setSavingCustomLinks] = useState(false)

    // ─── Tier Model State ────────────────────────────
    const [modelLow, setModelLow] = useState("claude-haiku-4-5-20251001")
    const [modelMedium, setModelMedium] = useState("claude-sonnet-4-6")
    const [modelHigh, setModelHigh] = useState("claude-opus-4-6")
    const [autoRouting, setAutoRouting] = useState(false)
    const [availableModels, setAvailableModels] = useState<string[]>([])

    // ─── Per-Sender Tracking Toggles ─────────────────────
    const senderEmails = ["lionel@musicalbasics.com", "lionel@email.dreamplaypianos.com"] as const
    const [trackingSettings, setTrackingSettings] = useState<Record<string, { click: boolean; open: boolean; resendClick: boolean; resendOpen: boolean }>>({
        "lionel@musicalbasics.com": { click: true, open: true, resendClick: false, resendOpen: false },
        "lionel@email.dreamplaypianos.com": { click: true, open: true, resendClick: false, resendOpen: false },
    })
    const { toast } = useToast()

    // ─── Load ───────────────────────────────────────
    useEffect(() => {
        async function loadAll() {
            try {
                const [ctx, lnk, cl, trackingMap] = await Promise.all([
                    getCompanyContext(audience as any),
                    getDefaultLinks(brand as any),
                    getCustomLinks(brand as any),
                    getAllTrackingSettings(),
                ])
                setContext(ctx)
                setLinks(lnk)
                setCustomLinks(cl)

                // Merge DB tracking settings with defaults
                const loadedTracking: Record<string, TrackingFlags> = {}
                for (const email of senderEmails) {
                    loadedTracking[email] = trackingMap[email] || { click: false, open: true, resendClick: false, resendOpen: false }
                }
                setTrackingSettings(loadedTracking)
            } catch (e) {
                console.error("Failed to load settings:", e)
            } finally {
                setLoading(false)
            }
        }
        loadAll()

        // Load tier models from localStorage (these are fine as client-only prefs)
        const savedLow = localStorage.getItem("mb_model_low")
        const savedMed = localStorage.getItem("mb_model_medium")
        const savedHigh = localStorage.getItem("mb_model_high")
        const savedAuto = localStorage.getItem("mb_auto_routing")
        if (savedLow) setModelLow(savedLow)
        if (savedMed) setModelMedium(savedMed)
        if (savedHigh) setModelHigh(savedHigh)
        if (savedAuto === "true") setAutoRouting(true)

        // Fetch available models
        getAnthropicModels().then(models => {
            if (models.length > 0) setAvailableModels(models)
        })
    }, [audience, brand])

    // ─── Save Handlers ──────────────────────────────
    const handleSaveContext = async () => {
        setSavingContext(true)
        try {
            await saveCompanyContext(audience as any, context)
            toast({ title: "Context Saved", description: `${wsLabel} context updated.` })
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" })
        } finally {
            setSavingContext(false)
        }
    }

    const handleSaveLinks = async () => {
        setSavingLinks(true)
        try {
            await saveDefaultLinks(brand as any, links)
            toast({ title: "Links Saved", description: `${wsLabel} links updated.` })
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" })
        } finally {
            setSavingLinks(false)
        }
    }

    const handleSaveCustomLinks = async () => {
        setSavingCustomLinks(true)
        try {
            await saveCustomLinks(brand as any, customLinks)
            toast({ title: "Custom Links Saved", description: `${wsLabel} custom links updated.` })
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" })
        } finally {
            setSavingCustomLinks(false)
        }
    }

    if (loading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-foreground">{wsLabel} Settings</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Configure AI context and default links for this workspace. The AI Copilot uses this data when generating email templates.
                </p>
            </div>
            {/* ─── Copilot Model Tiers Card ─── */}
            <Card className="mb-6">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Bot className="w-5 h-5 text-amber-500" />
                        Copilot Model Tiers
                    </CardTitle>
                    <CardDescription>
                        Assign a model to each compute tier. In the editor, you&apos;ll see 3 colored send buttons (🟢 🟡 🔴) to pick the tier per message.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    {/* Auto-Routing Toggle */}
                    <div className="flex items-center justify-between rounded-lg border border-border p-4 bg-muted/30">
                        <div className="flex items-center gap-3">
                            <Zap className="w-5 h-5 text-amber-400" />
                            <div>
                                <p className="text-sm font-medium text-foreground">Auto Smart Routing</p>
                                <p className="text-xs text-muted-foreground">
                                    When ON, the copilot shows 1 button and automatically picks Low or Medium based on prompt complexity.
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => {
                                const next = !autoRouting
                                setAutoRouting(next)
                                localStorage.setItem("mb_auto_routing", String(next))
                                toast({ title: next ? "Auto-Routing ON" : "Auto-Routing OFF", description: next ? "Copilot will auto-pick between your Low and Medium models." : "You'll see 3 send buttons to manually pick the tier." })
                            }}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoRouting ? "bg-primary" : "bg-muted-foreground/30"}`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoRouting ? "translate-x-6" : "translate-x-1"}`} />
                        </button>
                    </div>

                    {/* Tier Dropdowns */}
                    {([
                        { key: "low" as const, label: "Low Compute", icon: <Cpu className="w-4 h-4" />, color: "text-green-400", state: modelLow, setter: setModelLow, storageKey: "mb_model_low" },
                        { key: "medium" as const, label: "Medium Compute", icon: <Flame className="w-4 h-4" />, color: "text-amber-400", state: modelMedium, setter: setModelMedium, storageKey: "mb_model_medium" },
                        { key: "high" as const, label: "High Compute", icon: <Zap className="w-4 h-4" />, color: "text-red-400", state: modelHigh, setter: setModelHigh, storageKey: "mb_model_high" },
                    ]).map(tier => (
                        <div key={tier.key} className="grid grid-cols-3 gap-3 items-center">
                            <Label className={`text-sm font-medium flex items-center gap-2 ${tier.color}`}>
                                {tier.icon}
                                {tier.label}
                            </Label>
                            <div className="col-span-2">
                                <Select
                                    value={tier.state}
                                    onValueChange={(val) => {
                                        tier.setter(val)
                                        localStorage.setItem(tier.storageKey, val)
                                        toast({ title: `${tier.label} updated`, description: val })
                                    }}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableModels.map(model => (
                                            <SelectItem key={model} value={model}>{model}</SelectItem>
                                        ))}
                                        {availableModels.length === 0 && (
                                            <SelectItem value="claude-3-5-sonnet-20240620">Claude 3.5 Sonnet (Legacy)</SelectItem>
                                        )}
                                        <SelectItem value="gemini-1.5-pro">Gemini 1.5 Pro</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    ))}
                </CardContent>
            </Card>

            {/* ─── Email Tracking Card ─── */}
            <Card className="mb-6">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <MousePointerClick className="w-5 h-5 text-blue-500" />
                        Email Tracking
                    </CardTitle>
                    <CardDescription>
                        Control which tracking mechanisms are active in outgoing emails.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {senderEmails.map(email => {
                        const label = email.includes("musicalbasics") ? "MusicalBasics" : "DreamPlay Pianos"
                        const settings = trackingSettings[email] || { click: true, open: true, resendClick: false, resendOpen: false }
                        const toggleSetting = async (field: "click" | "open" | "resendClick" | "resendOpen") => {
                            const next = !settings[field]
                            const updated = { ...settings, [field]: next }

                            // Mutual exclusion: app and resend tracking can't both be ON for the same type
                            if (next) {
                                if (field === "click" && updated.resendClick) {
                                    updated.resendClick = false
                                    toast({ title: `Resend Click Tracking auto-disabled for ${label}`, description: "Cannot use both App and Resend click tracking simultaneously." })
                                } else if (field === "resendClick" && updated.click) {
                                    updated.click = false
                                    toast({ title: `App Click Tracking auto-disabled for ${label}`, description: "Cannot use both App and Resend click tracking simultaneously." })
                                } else if (field === "open" && updated.resendOpen) {
                                    updated.resendOpen = false
                                    toast({ title: `Resend Open Tracking auto-disabled for ${label}`, description: "Cannot use both App and Resend open tracking simultaneously." })
                                } else if (field === "resendOpen" && updated.open) {
                                    updated.open = false
                                    toast({ title: `App Open Tracking auto-disabled for ${label}`, description: "Cannot use both App and Resend open tracking simultaneously." })
                                }
                            }

                            const newSettings = { ...trackingSettings, [email]: updated }
                            setTrackingSettings(newSettings)

                            // Save to database
                            try {
                                await saveTrackingSettings(email, updated)
                            } catch (e: any) {
                                toast({ title: "Failed to save tracking settings", description: e.message, variant: "destructive" })
                            }

                            const labelMap: Record<string, string> = {
                                click: "Click Tracking",
                                open: "Open Tracking",
                                resendClick: "Resend Click Tracking",
                                resendOpen: "Resend Open Tracking",
                            }
                            toast({ title: `${labelMap[field]} ${next ? "ON" : "OFF"} for ${label}` })
                        }
                        return (
                            <div key={email} className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${email.includes("musicalbasics") ? "bg-amber-400" : "bg-blue-400"}`} />
                                    <p className="text-sm font-semibold text-foreground">{label}</p>
                                    <span className="text-[10px] text-muted-foreground font-mono">{email}</span>
                                </div>
                                {/* Click Tracking */}
                                <div className="flex items-center justify-between rounded-lg border border-border p-4 bg-muted/30 ml-4">
                                    <div className="flex items-center gap-3">
                                        <MousePointerClick className="w-4 h-4 text-blue-400" />
                                        <div>
                                            <p className="text-sm font-medium text-foreground">Click Tracking</p>
                                            <p className="text-xs text-muted-foreground">Rewrite links through <code className="text-xs">/api/track/click</code></p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => toggleSetting("click")}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings.click ? "bg-primary" : "bg-muted-foreground/30"}`}
                                    >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.click ? "translate-x-6" : "translate-x-1"}`} />
                                    </button>
                                </div>
                                {/* Open Tracking */}
                                <div className="flex items-center justify-between rounded-lg border border-border p-4 bg-muted/30 ml-4">
                                    <div className="flex items-center gap-3">
                                        <Eye className="w-4 h-4 text-purple-400" />
                                        <div>
                                            <p className="text-sm font-medium text-foreground">Open Tracking</p>
                                            <p className="text-xs text-muted-foreground">Inject a 1×1 tracking pixel for open detection</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => toggleSetting("open")}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings.open ? "bg-primary" : "bg-muted-foreground/30"}`}
                                    >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.open ? "translate-x-6" : "translate-x-1"}`} />
                                    </button>
                                </div>
                                {/* Resend Click Tracking */}
                                <div className="flex items-center justify-between rounded-lg border border-border p-4 bg-muted/30 ml-4">
                                    <div className="flex items-center gap-3">
                                        <Send className="w-4 h-4 text-emerald-400" />
                                        <div>
                                            <p className="text-sm font-medium text-foreground">Resend Click Tracking</p>
                                            <p className="text-xs text-muted-foreground">Let Resend rewrite links for its own click analytics</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => toggleSetting("resendClick")}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings.resendClick ? "bg-primary" : "bg-muted-foreground/30"}`}
                                    >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.resendClick ? "translate-x-6" : "translate-x-1"}`} />
                                    </button>
                                </div>
                                {/* Resend Open Tracking */}
                                <div className="flex items-center justify-between rounded-lg border border-border p-4 bg-muted/30 ml-4">
                                    <div className="flex items-center gap-3">
                                        <Send className="w-4 h-4 text-orange-400" />
                                        <div>
                                            <p className="text-sm font-medium text-foreground">Resend Open Tracking</p>
                                            <p className="text-xs text-muted-foreground">Let Resend inject its own open-tracking pixel</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => toggleSetting("resendOpen")}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings.resendOpen ? "bg-primary" : "bg-muted-foreground/30"}`}
                                    >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.resendOpen ? "translate-x-6" : "translate-x-1"}`} />
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                </CardContent>
            </Card>

            {/* ─── Workspace Context & Links ─── */}
            <div className="space-y-6">
                <BrandContextCard
                    title={`${wsLabel} Context`}
                    description={`Company and product context for ${wsLabel}.`}
                    value={context}
                    onChange={setContext}
                    onSave={handleSaveContext}
                    saving={savingContext}
                />
                <BrandLinksCard
                    title={`${wsLabel} Links`}
                    links={links}
                    onChange={(key, val) => setLinks(prev => ({ ...prev, [key]: val }))}
                    onSave={handleSaveLinks}
                    saving={savingLinks}
                />
                <CustomLinksCard
                    title={`${wsLabel} Custom Links`}
                    links={customLinks}
                    onChange={setCustomLinks}
                    onSave={handleSaveCustomLinks}
                    saving={savingCustomLinks}
                />
            </div>
        </div>
    )
}

// ─── Sub-components ─────────────────────────────────────

function BrandContextCard({
    title, description, value, onChange, onSave, saving
}: {
    title: string; description: string; value: string
    onChange: (v: string) => void; onSave: () => void; saving: boolean
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Brain className="w-5 h-5 text-purple-400" />
                    {title}
                </CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <Textarea
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="Describe your brand, products, tone, and any context the AI should know..."
                    rows={6}
                />
                <Button onClick={onSave} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    Save Context
                </Button>
            </CardContent>
        </Card>
    )
}

function BrandLinksCard({
    title, links, onChange, onSave, saving
}: {
    title: string; links: DefaultLinks
    onChange: (key: keyof DefaultLinks, value: string) => void
    onSave: () => void; saving: boolean
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Link2 className="w-5 h-5 text-blue-400" />
                    {title}
                </CardTitle>
                <CardDescription>
                    Default URLs the AI Copilot uses when generating templates for this brand.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {(Object.keys(LINK_LABELS) as (keyof DefaultLinks)[]).map((key) => (
                    <div key={key} className="grid grid-cols-3 gap-3 items-center">
                        <div>
                            <Label className="text-sm text-muted-foreground">{LINK_LABELS[key]}</Label>
                            <p className="text-[10px] text-muted-foreground/50 font-mono mt-0.5">{`{{${key}}}`}</p>
                        </div>
                        <Input
                            value={links[key]}
                            onChange={(e) => onChange(key, e.target.value)}
                            placeholder={`https://...`}
                            className="col-span-2"
                        />
                    </div>
                ))}
                <Button onClick={onSave} disabled={saving} className="mt-2">
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    Save Links
                </Button>
            </CardContent>
        </Card>
    )
}

function CustomLinksCard({
    title, links, onChange, onSave, saving
}: {
    title: string; links: CustomLink[]
    onChange: (links: CustomLink[]) => void
    onSave: () => void; saving: boolean
}) {
    const addLink = () => {
        onChange([...links, { label: "", url: "" }])
    }

    const removeLink = (index: number) => {
        onChange(links.filter((_, i) => i !== index))
    }

    const updateEntry = (index: number, field: "label" | "url", value: string) => {
        const updated = [...links]
        updated[index] = { ...updated[index], [field]: value }
        onChange(updated)
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Link2 className="w-5 h-5 text-emerald-400" />
                    {title}
                </CardTitle>
                <CardDescription>
                    Custom links that appear in the asset loader dropdown. Add frequently used URLs here.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {links.map((link, i) => (
                    <div key={i} className="flex gap-2 items-center">
                        <Input
                            value={link.label}
                            onChange={(e) => updateEntry(i, "label", e.target.value)}
                            placeholder="Label (e.g. Product Page)"
                            className="w-[180px] flex-shrink-0"
                        />
                        <Input
                            value={link.url}
                            onChange={(e) => updateEntry(i, "url", e.target.value)}
                            placeholder="https://..."
                            className="flex-1"
                        />
                        <Button
                            variant="ghost"
                            size="icon"
                            className="flex-shrink-0 text-muted-foreground hover:text-red-400"
                            onClick={() => removeLink(i)}
                        >
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </div>
                ))}

                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={addLink} className="gap-1">
                        <Plus className="w-3.5 h-3.5" />
                        Add Link
                    </Button>
                    <Button size="sm" onClick={onSave} disabled={saving}>
                        {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                        Save Custom Links
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}
