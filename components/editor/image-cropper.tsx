"use client"

import React, { useState, useRef, useEffect } from 'react'
import ReactCrop, { type Crop, type PixelCrop, centerCrop, makeAspectCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { Button } from "@/components/ui/button"
import { Loader2, Check, X, RotateCcw } from "lucide-react"

// --- HELPER: CENTER ASPECT CROP ---
function centerAspectCrop(mediaWidth: number, mediaHeight: number, aspect: number) {
    return centerCrop(
        makeAspectCrop(
            {
                unit: '%',
                width: 90,
            },
            aspect,
            mediaWidth,
            mediaHeight,
        ),
        mediaWidth,
        mediaHeight,
    )
}

interface ImageCropperProps {
    src: string
    onCropComplete: (croppedBlob: Blob) => void
    onCancel: () => void
    onSkip?: () => void
    initialAspect?: number // Optional: lock aspect ratio if needed (e.g., 16/9)
}

export function ImageCropper({ src, onCropComplete, onCancel, onSkip, initialAspect }: ImageCropperProps) {
    const [crop, setCrop] = useState<Crop>()
    const [completedCrop, setCompletedCrop] = useState<PixelCrop>()
    const [aspect, setAspect] = useState<number | undefined>(initialAspect)
    const imgRef = useRef<HTMLImageElement>(null)
    const [isProcessing, setIsProcessing] = useState(false)

    const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const { width, height } = e.currentTarget

        // Default to whole image if no aspect
        if (aspect) {
            setCrop(centerAspectCrop(width, height, aspect))
        } else {
            setCrop({
                unit: '%',
                width: 100,
                height: 100,
                x: 0,
                y: 0
            })
        }
    }

    const getCroppedImg = async (image: HTMLImageElement, crop: PixelCrop): Promise<Blob> => {
        const canvas = document.createElement('canvas')
        const scaleX = image.naturalWidth / image.width
        const scaleY = image.naturalHeight / image.height

        canvas.width = crop.width * scaleX
        canvas.height = crop.height * scaleY

        const ctx = canvas.getContext('2d')

        if (!ctx) {
            throw new Error('No 2d context')
        }

        // Quality improvement
        ctx.imageSmoothingQuality = 'high'

        ctx.drawImage(
            image,
            crop.x * scaleX,
            crop.y * scaleY,
            crop.width * scaleX,
            crop.height * scaleY,
            0,
            0,
            crop.width * scaleX,
            crop.height * scaleY,
        )

        return new Promise((resolve, reject) => {
            canvas.toBlob(
                (blob) => {
                    if (!blob) {
                        reject(new Error('Canvas is empty'))
                        return
                    }
                    resolve(blob)
                },
                'image/jpeg',
                0.9 // High quality
            )
        })
    }

    const handleSave = async () => {
        if (!completedCrop || !imgRef.current) return

        setIsProcessing(true)
        try {
            // If crop covers the whole image (approx), just use original? 
            // Actually, better to always re-process to ensure consistent behavior, 
            // unless user explicitly hit "Skip". 
            // But here we are in "Crop" mode, so we crop.

            const blob = await getCroppedImg(imgRef.current, completedCrop)
            onCropComplete(blob)
        } catch (e) {
            console.error(e)
            setIsProcessing(false)
        }
    }

    return (
        <div className="flex flex-col h-full bg-black/90 text-white rounded-lg overflow-hidden">
            <div className="flex-1 flex items-center justify-center p-8 overflow-auto min-h-[300px]">
                <ReactCrop
                    crop={crop}
                    onChange={(_, percentCrop) => setCrop(percentCrop)}
                    onComplete={(c) => setCompletedCrop(c)}
                    aspect={aspect}
                    className="max-h-[60vh]"
                >
                    <img
                        ref={imgRef}
                        alt="Crop me"
                        src={src}
                        onLoad={onImageLoad}
                        style={{ maxHeight: '60vh', objectFit: 'contain' }}
                        crossOrigin="anonymous" // Important for CORS if assets are external
                    />
                </ReactCrop>
            </div>

            <div className="p-4 border-t border-white/10 flex items-center justify-between bg-zinc-900">
                <div className="flex gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAspect(undefined)}
                        className={!aspect ? "bg-white/10" : ""}
                    >
                        Free
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAspect(1)}
                        className={aspect === 1 ? "bg-white/10" : ""}
                    >
                        Square
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAspect(16 / 9)}
                        className={aspect === 16 / 9 ? "bg-white/10" : ""}
                    >
                        16:9
                    </Button>
                </div>

                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={onCancel} disabled={isProcessing}>
                        <X className="w-4 h-4 mr-2" />
                        Cancel
                    </Button>
                    {onSkip && (
                        <Button variant="secondary" onClick={onSkip} disabled={isProcessing}>
                            Use as is
                        </Button>
                    )}
                    <Button onClick={handleSave} disabled={isProcessing || !completedCrop?.width}>
                        {isProcessing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                        Save Crop
                    </Button>
                </div>
            </div>
        </div>
    )
}
