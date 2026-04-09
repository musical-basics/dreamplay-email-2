"use client"

import { useState, useEffect } from "react"
import { Save, Trash2, Plus, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { type CRMScoringConfig, DEFAULT_CRM_CONFIG } from "@/lib/crm-types"

const PRESETS_KEY = "dp_crm_presets"
const ACTIVE_PRESET_KEY = "dp_crm_active_preset"

export interface CRMPreset {
    name: string
    config: CRMScoringConfig
}

const BUILT_IN_PRESETS: CRMPreset[] = [
    {
        name: "All Leads (score > 5)",
        config: { ...DEFAULT_CRM_CONFIG, min_score: 5, max_score: null },
    },
    {
        name: "Hot Leads (score > 50)",
        config: { ...DEFAULT_CRM_CONFIG, min_score: 50, max_score: null },
    },
    {
        name: "Warm Leads (25-50)",
        config: { ...DEFAULT_CRM_CONFIG, min_score: 25, max_score: 50 },
    },
    {
        name: "Cooler Leads (5-25)",
        config: { ...DEFAULT_CRM_CONFIG, min_score: 5, max_score: 25 },
    },
]

function loadPresets(): CRMPreset[] {
    if (typeof window === "undefined") return []
    try {
        const raw = localStorage.getItem(PRESETS_KEY)
        return raw ? JSON.parse(raw) : []
    } catch {
        return []
    }
}

function savePresets(presets: CRMPreset[]) {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets))
}

export function getActiveConfig(): CRMScoringConfig {
    if (typeof window === "undefined") return DEFAULT_CRM_CONFIG
    try {
        const raw = localStorage.getItem(ACTIVE_PRESET_KEY)
        return raw ? JSON.parse(raw) : DEFAULT_CRM_CONFIG
    } catch {
        return DEFAULT_CRM_CONFIG
    }
}

export function setActiveConfig(config: CRMScoringConfig) {
    localStorage.setItem(ACTIVE_PRESET_KEY, JSON.stringify(config))
}

interface Props {
    onConfigChange: (config: CRMScoringConfig) => void
}

export function CRMConfigPanel({ onConfigChange }: Props) {
    const [config, setConfig] = useState<CRMScoringConfig>(DEFAULT_CRM_CONFIG)
    const [customPresets, setCustomPresets] = useState<CRMPreset[]>([])
    const [newPresetName, setNewPresetName] = useState("")
    const [newBoostTag, setNewBoostTag] = useState("")
    const [newBoostValue, setNewBoostValue] = useState(20)
    const [newExcludeTag, setNewExcludeTag] = useState("")
    const { toast } = useToast()

    useEffect(() => {
        const saved = getActiveConfig()
        setConfig(saved)
        setCustomPresets(loadPresets())
    }, [])

    const updateField = <K extends keyof CRMScoringConfig>(key: K, value: CRMScoringConfig[K]) => {
        setConfig(prev => ({ ...prev, [key]: value }))
    }

    const applyConfig = () => {
        setActiveConfig(config)
        onConfigChange(config)
        toast({ title: "Config applied", description: "CRM scores will recalculate with new settings." })
    }

    const loadPreset = (preset: CRMPreset) => {
        setConfig(preset.config)
        setActiveConfig(preset.config)
        onConfigChange(preset.config)
        toast({ title: `Loaded "${preset.name}"` })
    }

    const saveAsPreset = () => {
        if (!newPresetName.trim()) return
        const updated = [...customPresets.filter(p => p.name !== newPresetName), { name: newPresetName, config }]
        setCustomPresets(updated)
        savePresets(updated)
        setNewPresetName("")
        toast({ title: "Preset saved", description: `"${newPresetName}" saved successfully.` })
    }

    const deletePreset = (name: string) => {
        const updated = customPresets.filter(p => p.name !== name)
        setCustomPresets(updated)
        savePresets(updated)
        toast({ title: "Preset deleted" })
    }

    const addTagBoost = () => {
        if (!newBoostTag.trim()) return
        const existing = config.tag_boosts.filter(tb => tb.tag !== newBoostTag)
        updateField("tag_boosts", [...existing, { tag: newBoostTag, boost: newBoostValue }])
        setNewBoostTag("")
        setNewBoostValue(20)
    }

    const removeTagBoost = (tag: string) => {
        updateField("tag_boosts", config.tag_boosts.filter(tb => tb.tag !== tag))
    }

    const addExcludeTag = () => {
        if (!newExcludeTag.trim() || config.exclude_tags.includes(newExcludeTag)) return
        updateField("exclude_tags", [...config.exclude_tags, newExcludeTag])
        setNewExcludeTag("")
    }

    const removeExcludeTag = (tag: string) => {
        updateField("exclude_tags", config.exclude_tags.filter(t => t !== tag))
    }

    return (
        <div className="space-y-6 max-w-3xl">
            {/* Presets */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Presets</CardTitle>
                    <CardDescription>Quick-load a scoring configuration</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                        {BUILT_IN_PRESETS.map(p => (
                            <Button key={p.name} variant="outline" size="sm" onClick={() => loadPreset(p)}>
                                {p.name}
                            </Button>
                        ))}
                    </div>
                    {customPresets.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-2 border-t">
                            {customPresets.map(p => (
                                <div key={p.name} className="flex items-center gap-1">
                                    <Button variant="secondary" size="sm" onClick={() => loadPreset(p)}>
                                        {p.name}
                                    </Button>
                                    <button onClick={() => deletePreset(p.name)} className="text-muted-foreground hover:text-red-500 p-1">
                                        <Trash2 className="h-3 w-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="flex gap-2 pt-2">
                        <Input
                            placeholder="My custom preset..."
                            value={newPresetName}
                            onChange={e => setNewPresetName(e.target.value)}
                            className="max-w-[250px]"
                            onKeyDown={e => e.key === "Enter" && saveAsPreset()}
                        />
                        <Button size="sm" variant="outline" onClick={saveAsPreset} disabled={!newPresetName.trim()}>
                            <Save className="h-3.5 w-3.5 mr-1.5" />
                            Save Current
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Base Points */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Base Points</CardTitle>
                    <CardDescription>Points awarded per event type (before time decay)</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                        {([
                            ["points_conversion", "Conversion"],
                            ["points_checkout_page", "Checkout Page View"],
                            ["points_click", "Email Click"],
                            ["points_page_view", "Page View"],
                            ["points_open", "Email Open"],
                            ["points_session_max", "Session Duration (max)"],
                        ] as const).map(([key, label]) => (
                            <div key={key} className="space-y-1">
                                <Label className="text-xs text-muted-foreground">{label}</Label>
                                <Input
                                    type="number"
                                    value={config[key]}
                                    onChange={e => updateField(key, Number(e.target.value))}
                                    className="h-8"
                                />
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Time Decay */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Time Decay</CardTitle>
                    <CardDescription>Recent actions are worth more. Configure the windows and multipliers.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Recent window (days)</Label>
                            <Input type="number" value={config.decay_recent_days} onChange={e => updateField("decay_recent_days", Number(e.target.value))} className="h-8" />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Recent multiplier</Label>
                            <Input type="number" step="0.1" value={config.decay_recent_multiplier} onChange={e => updateField("decay_recent_multiplier", Number(e.target.value))} className="h-8" />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Mid window (days)</Label>
                            <Input type="number" value={config.decay_mid_days} onChange={e => updateField("decay_mid_days", Number(e.target.value))} className="h-8" />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Mid multiplier</Label>
                            <Input type="number" step="0.1" value={config.decay_mid_multiplier} onChange={e => updateField("decay_mid_multiplier", Number(e.target.value))} className="h-8" />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Old multiplier</Label>
                            <Input type="number" step="0.1" value={config.decay_old_multiplier} onChange={e => updateField("decay_old_multiplier", Number(e.target.value))} className="h-8" />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Lookback (days)</Label>
                            <Input type="number" value={config.event_lookback_days} onChange={e => updateField("event_lookback_days", Number(e.target.value))} className="h-8" />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Tag Boosts */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Tag Boosts</CardTitle>
                    <CardDescription>Bonus points for subscribers with specific tags</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                        {config.tag_boosts.map(tb => (
                            <Badge key={tb.tag} variant="secondary" className="gap-1.5 pr-1">
                                {tb.tag} (+{tb.boost})
                                <button onClick={() => removeTagBoost(tb.tag)} className="hover:text-red-500 ml-1">×</button>
                            </Badge>
                        ))}
                    </div>
                    <div className="flex gap-2 items-end">
                        <div className="space-y-1 flex-1">
                            <Label className="text-xs text-muted-foreground">Tag name</Label>
                            <Input value={newBoostTag} onChange={e => setNewBoostTag(e.target.value)} placeholder="e.g. VIP Account" className="h-8" />
                        </div>
                        <div className="space-y-1 w-20">
                            <Label className="text-xs text-muted-foreground">Boost</Label>
                            <Input type="number" value={newBoostValue} onChange={e => setNewBoostValue(Number(e.target.value))} className="h-8" />
                        </div>
                        <Button size="sm" variant="outline" onClick={addTagBoost} className="h-8"><Plus className="h-3 w-3" /></Button>
                    </div>
                </CardContent>
            </Card>

            {/* Exclude Tags */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Exclude Tags</CardTitle>
                    <CardDescription>Subscribers with these tags are hidden from the CRM</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                        {config.exclude_tags.map(tag => (
                            <Badge key={tag} variant="destructive" className="gap-1.5 pr-1">
                                {tag}
                                <button onClick={() => removeExcludeTag(tag)} className="hover:text-white ml-1">×</button>
                            </Badge>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <Input value={newExcludeTag} onChange={e => setNewExcludeTag(e.target.value)} placeholder="Tag to exclude..." className="h-8 max-w-[250px]" onKeyDown={e => e.key === "Enter" && addExcludeTag()} />
                        <Button size="sm" variant="outline" onClick={addExcludeTag} className="h-8"><Plus className="h-3 w-3" /></Button>
                    </div>
                </CardContent>
            </Card>

            {/* Score Filter */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Score Range Filter</CardTitle>
                    <CardDescription>Only show leads within this engagement score range</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Minimum score</Label>
                            <Input type="number" value={config.min_score} onChange={e => updateField("min_score", Number(e.target.value))} className="h-8" />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Maximum score (blank = no limit)</Label>
                            <Input
                                type="number"
                                value={config.max_score ?? ""}
                                onChange={e => updateField("max_score", e.target.value === "" ? null : Number(e.target.value))}
                                placeholder="No limit"
                                className="h-8"
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Apply */}
            <div className="flex gap-3 sticky bottom-0 bg-background py-4 border-t">
                <Button onClick={applyConfig} className="bg-amber-600 hover:bg-amber-500 text-white">
                    Apply & Refresh Leads
                </Button>
                <Button variant="outline" onClick={() => { setConfig(DEFAULT_CRM_CONFIG); }}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                    Reset to Defaults
                </Button>
            </div>
        </div>
    )
}
