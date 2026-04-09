"use client"

import { useState } from "react"
import { Rocket, AlertTriangle, CalendarClock, X, Clock, CalendarIcon } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"

interface LaunchpadCardProps {
    subscriberCount: number
    onLaunch: () => void
    onSchedule: (date: Date) => void
    onCancelSchedule: () => void
    isDisabled?: boolean
    scheduledAt?: string | null
    scheduledStatus?: string | null
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = [0, 15, 30, 45]

export function LaunchpadCard({
    subscriberCount,
    onLaunch,
    onSchedule,
    onCancelSchedule,
    isDisabled,
    scheduledAt,
    scheduledStatus,
}: LaunchpadCardProps) {
    const [showSchedulePicker, setShowSchedulePicker] = useState(false)
    const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined)
    const [selectedHour, setSelectedHour] = useState<number | null>(null)
    const [selectedMinute, setSelectedMinute] = useState<number | null>(null)
    const [calendarOpen, setCalendarOpen] = useState(false)
    const [timeOpen, setTimeOpen] = useState(false)

    const isScheduled = scheduledAt && scheduledStatus === "pending"

    const handleScheduleSubmit = () => {
        if (!selectedDate || selectedHour === null || selectedMinute === null) return
        const dt = new Date(selectedDate)
        dt.setHours(selectedHour, selectedMinute, 0, 0)
        if (dt <= new Date()) return
        onSchedule(dt)
        setShowSchedulePicker(false)
        setSelectedDate(undefined)
        setSelectedHour(null)
        setSelectedMinute(null)
    }

    const formatScheduledTime = (isoString: string) => {
        const d = new Date(isoString)
        return d.toLocaleString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        })
    }

    const formatSelectedDate = (date: Date) => {
        return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        })
    }

    const formatTime = (hour: number, minute: number) => {
        const period = hour >= 12 ? "PM" : "AM"
        const h = hour % 12 || 12
        const m = minute.toString().padStart(2, "0")
        return `${h}:${m} ${period}`
    }

    const canConfirm = selectedDate && selectedHour !== null && selectedMinute !== null

    return (
        <Card className="border-2 border-[#D4AF37]/30 bg-gradient-to-b from-[#D4AF37]/5 to-transparent">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-medium text-foreground">
                    <Rocket className="h-5 w-5 text-[#D4AF37]" />
                    The Launchpad
                </CardTitle>
                <CardDescription className="text-muted-foreground">Danger Zone — This action cannot be undone.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                    <p className="text-sm text-muted-foreground">
                        You are about to send this campaign to{" "}
                        <span className="font-semibold text-foreground">
                            {subscriberCount === 1 ? "1 subscriber" : `${subscriberCount.toLocaleString()} subscribers`}
                        </span>.
                        Please review everything before launching.
                    </p>
                </div>

                {/* Scheduled indicator */}
                {isScheduled && (
                    <div className="flex items-center justify-between rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
                        <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-sky-400" />
                            <div>
                                <p className="text-sm font-medium text-sky-300">Scheduled</p>
                                <p className="text-xs text-muted-foreground">{formatScheduledTime(scheduledAt!)}</p>
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onCancelSchedule}
                            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        >
                            <X className="h-4 w-4 mr-1" />
                            Cancel
                        </Button>
                    </div>
                )}

                {/* Action buttons */}
                {!isScheduled && (
                    <div className="flex gap-2">
                        <Button
                            onClick={onLaunch}
                            disabled={isDisabled}
                            className="flex-1 gap-2 bg-[#D4AF37] text-[#050505] hover:bg-[#b8962e] disabled:opacity-50"
                            size="lg"
                        >
                            <Rocket className="h-5 w-5" />
                            Send Now
                        </Button>
                        <Button
                            onClick={() => setShowSchedulePicker(!showSchedulePicker)}
                            disabled={isDisabled}
                            variant="outline"
                            size="lg"
                            className="gap-2 border-[#D4AF37]/30 text-[#D4AF37] hover:bg-[#D4AF37]/10"
                        >
                            <CalendarClock className="h-5 w-5" />
                            Schedule
                        </Button>
                    </div>
                )}

                {/* Schedule picker */}
                {showSchedulePicker && !isScheduled && (
                    <div className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
                        <p className="text-sm font-medium text-foreground">Pick a date and time</p>
                        <div className="flex gap-2">
                            {/* Date Picker */}
                            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className={cn(
                                            "flex-1 justify-start text-left font-normal gap-2",
                                            !selectedDate && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="h-4 w-4 shrink-0" />
                                        {selectedDate ? formatSelectedDate(selectedDate) : "Pick date"}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={selectedDate}
                                        onSelect={(date) => {
                                            setSelectedDate(date)
                                            setCalendarOpen(false)
                                        }}
                                        disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                                    />
                                </PopoverContent>
                            </Popover>

                            {/* Time Picker */}
                            <Popover open={timeOpen} onOpenChange={setTimeOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className={cn(
                                            "w-[130px] justify-start text-left font-normal gap-2",
                                            selectedHour === null && "text-muted-foreground"
                                        )}
                                    >
                                        <Clock className="h-4 w-4 shrink-0" />
                                        {selectedHour !== null && selectedMinute !== null
                                            ? formatTime(selectedHour, selectedMinute)
                                            : "Pick time"
                                        }
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[200px] p-0" align="start">
                                    <ScrollArea className="h-[240px]">
                                        <div className="p-1">
                                            {HOURS.map(hour =>
                                                MINUTES.map(minute => {
                                                    const isSelected = selectedHour === hour && selectedMinute === minute
                                                    return (
                                                        <Button
                                                            key={`${hour}-${minute}`}
                                                            variant={isSelected ? "default" : "ghost"}
                                                            size="sm"
                                                            className={cn(
                                                                "w-full justify-start text-sm font-normal",
                                                                isSelected && "bg-[#D4AF37] text-[#050505] hover:bg-[#b8962e]"
                                                            )}
                                                            onClick={() => {
                                                                setSelectedHour(hour)
                                                                setSelectedMinute(minute)
                                                                setTimeOpen(false)
                                                            }}
                                                        >
                                                            {formatTime(hour, minute)}
                                                        </Button>
                                                    )
                                                })
                                            )}
                                        </div>
                                    </ScrollArea>
                                </PopoverContent>
                            </Popover>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                onClick={handleScheduleSubmit}
                                disabled={!canConfirm}
                                className="flex-1 gap-2 bg-sky-600 text-white hover:bg-sky-500"
                                size="sm"
                            >
                                <CalendarClock className="h-4 w-4" />
                                Confirm Schedule
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowSchedulePicker(false)}
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                )}

                {isDisabled && !isScheduled && (
                    <p className="text-center text-sm text-muted-foreground">This campaign has already been sent.</p>
                )}
            </CardContent>
        </Card>
    )
}
