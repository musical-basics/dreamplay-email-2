import { useState } from "react"
import { Beaker } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface TestVariablesPopoverProps {
    variables: string[]
    testData: Record<string, string>
    onUpdateTestValue: (key: string, value: string) => void
    onClearAll: () => void
}

export function TestVariablesPopover({ variables, testData, onUpdateTestValue, onClearAll }: TestVariablesPopoverProps) {
    const hasData = Object.keys(testData).some(k => testData[k] !== "")
    
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button 
                    variant="outline" 
                    size="sm" 
                    className={`h-8 gap-1.5 ${hasData ? 'bg-primary/10 text-primary border-primary/20' : 'bg-background hover:bg-muted text-muted-foreground hover:text-foreground'}`}
                    title="Test Merge Variables"
                >
                    <Beaker className="w-3.5 h-3.5" />
                    <span className="text-xs">Test Data</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
                <div className="flex items-center justify-between p-3 border-b border-border bg-muted/30">
                    <div>
                        <h4 className="font-semibold text-sm">Test Variables</h4>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Preview email with sample data</p>
                    </div>
                    {hasData && (
                        <Button variant="ghost" size="sm" onClick={onClearAll} className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground">
                            Clear
                        </Button>
                    )}
                </div>
                <div className="p-3 max-h-[300px] overflow-y-auto space-y-3">
                    {variables.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-4">No subscriber merge tags found in template.</p>
                    ) : (
                        variables.map(variable => (
                            <div key={variable} className="space-y-1.5">
                                <Label htmlFor={`test-${variable}`} className="text-xs font-mono text-muted-foreground">
                                    {`{{${variable}}}`}
                                </Label>
                                <Input
                                    id={`test-${variable}`}
                                    value={testData[variable] || ""}
                                    onChange={(e) => onUpdateTestValue(variable, e.target.value)}
                                    placeholder={`Sample ${variable}...`}
                                    className="h-8 text-xs font-mono bg-background"
                                />
                            </div>
                        ))
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}
