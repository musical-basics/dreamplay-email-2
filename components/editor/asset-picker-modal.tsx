"use client"

import type React from "react"
import { useState, useCallback, useEffect } from "react"
import { X, Upload, ImageIcon, Loader2, Trash2, FolderPlus, Folder, ChevronRight, LayoutGrid, List, Home, FolderInput, CheckSquare, Square } from "lucide-react"
import { cn } from "@/lib/utils"
import { deleteAsset, deleteAssets, createFolder, deleteFolder, moveAsset, moveAssets, getAssets, getFolders, getSubFolders, uploadHashedAsset } from "@/app/actions/assets"
import { ImageCropper } from "./image-cropper"

interface Asset {
    id: string
    filename: string
    folder_path: string
    storage_hash: string
    public_url: string
    size?: number
    created_at?: string
}

interface FolderItem {
    name: string
}

interface AssetPickerModalProps {
    isOpen: boolean
    onClose: () => void
    onSelect: (url: string) => void
}

type ViewMode = "grid" | "list"

export function AssetPickerModal({ isOpen, onClose, onSelect }: AssetPickerModalProps) {
    const [assets, setAssets] = useState<Asset[]>([])
    const [folders, setFolders] = useState<FolderItem[]>([])
    const [loading, setLoading] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
    const [croppingAsset, setCroppingAsset] = useState<Asset | null>(null)
    const [isDragOver, setIsDragOver] = useState(false)
    const [deleting, setDeleting] = useState<string | null>(null)
    const [currentFolder, setCurrentFolder] = useState("")
    const [viewMode, setViewMode] = useState<ViewMode>("grid")
    const [creatingFolder, setCreatingFolder] = useState(false)
    const [newFolderName, setNewFolderName] = useState("")
    const [creatingFolderLoading, setCreatingFolderLoading] = useState(false)
    const [movingAsset, setMovingAsset] = useState<string | null>(null)
    const [dropTargetFolder, setDropTargetFolder] = useState<string | null>(null)

    // ─── Multi-Select State ───
    const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set())
    const [bulkDeleting, setBulkDeleting] = useState(false)
    const [bulkMoving, setBulkMoving] = useState(false)
    const [showMoveDialog, setShowMoveDialog] = useState(false)
    const [allFolders, setAllFolders] = useState<string[]>([])

    const isMultiSelectMode = multiSelectedIds.size > 0

    // ─── Fetch assets from DB ───
    const fetchAssets = useCallback(async () => {
        setLoading(true)
        setSelectedAsset(null)

        // Fetch assets in the current folder
        const { assets: dbAssets } = await getAssets(currentFolder)
        const fileItems: Asset[] = (dbAssets || []).filter((a: Asset) => a.filename !== ".folder")
        setAssets(fileItems)

        // Fetch subfolders
        let folderItems: FolderItem[] = []
        if (currentFolder) {
            const { folders: subFolders } = await getSubFolders(currentFolder)
            folderItems = subFolders.map((name: string) => ({ name }))
        } else {
            const { folders: rootFolders } = await getFolders()
            folderItems = rootFolders.map((name: string) => ({ name }))
        }
        setFolders(folderItems)

        setLoading(false)
    }, [currentFolder])

    useEffect(() => {
        if (isOpen) {
            fetchAssets()
        }
    }, [isOpen, fetchAssets])

    // Reset state when modal closes
    useEffect(() => {
        if (!isOpen) {
            setCurrentFolder("")
            setSelectedAsset(null)
            setCroppingAsset(null)
            setCreatingFolder(false)
            setMultiSelectedIds(new Set())
            setShowMoveDialog(false)
        }
    }, [isOpen])

    // Clear multi-select when navigating folders
    useEffect(() => {
        setMultiSelectedIds(new Set())
    }, [currentFolder])

    // ─── Fetch all root folders for "Move to" dialog ───
    const fetchAllFolders = useCallback(async () => {
        const { folders: rootFolders } = await getFolders()
        setAllFolders(rootFolders)
    }, [])

    // ─── Multi-Select Handlers ───
    const toggleMultiSelect = (assetId: string, e?: React.MouseEvent) => {
        e?.stopPropagation()
        setMultiSelectedIds(prev => {
            const next = new Set(prev)
            if (next.has(assetId)) {
                next.delete(assetId)
            } else {
                next.add(assetId)
            }
            return next
        })
    }

    const selectAll = () => {
        if (multiSelectedIds.size === assets.length) {
            setMultiSelectedIds(new Set())
        } else {
            setMultiSelectedIds(new Set(assets.map(a => a.id)))
        }
    }

    const getSelectedAssets = () => assets.filter(a => multiSelectedIds.has(a.id))

    const handleBulkDelete = async () => {
        const selected = getSelectedAssets()
        if (selected.length === 0) return
        if (!confirm(`Delete ${selected.length} asset${selected.length > 1 ? "s" : ""}? They will be hidden from the library.`)) return

        setBulkDeleting(true)
        const ids = selected.map(a => a.id)
        const result = await deleteAssets(ids)

        if (!result.success) {
            console.error("Error bulk deleting:", result.error)
        } else {
            setMultiSelectedIds(new Set())
            if (selectedAsset && multiSelectedIds.has(selectedAsset.id)) {
                setSelectedAsset(null)
            }
            await fetchAssets()
        }
        setBulkDeleting(false)
    }

    const handleBulkMoveToFolder = async (targetFolder: string) => {
        const selected = getSelectedAssets()
        if (selected.length === 0) return

        setBulkMoving(true)
        const ids = selected.map(a => a.id)
        const result = await moveAssets(ids, targetFolder)

        if (!result.success) {
            console.error("Error bulk moving:", result.error)
        } else {
            setMultiSelectedIds(new Set())
            setShowMoveDialog(false)
            await fetchAssets()
        }
        setBulkMoving(false)
    }

    const openMoveDialog = async () => {
        await fetchAllFolders()
        setShowMoveDialog(true)
    }

    const compressImage = async (file: File): Promise<File> => {
        return new Promise((resolve, reject) => {
            const img = new Image()
            const reader = new FileReader()

            // Preserve PNG format (supports transparency); compress others as JPEG
            const isPng = file.type === "image/png"
            const outputType = isPng ? "image/png" : "image/jpeg"

            reader.onload = (e) => {
                img.src = e.target?.result as string
            }
            reader.onerror = reject

            img.onload = () => {
                const canvas = document.createElement("canvas")
                const ctx = canvas.getContext("2d")
                if (!ctx) return reject(new Error("Canvas context failed"))

                const MAX_WIDTH = 1600
                const MAX_HEIGHT = 1600
                let width = img.width
                let height = img.height

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width
                        width = MAX_WIDTH
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height
                        height = MAX_HEIGHT
                    }
                }

                canvas.width = width
                canvas.height = height

                // For PNGs: clear canvas to transparent before drawing
                if (isPng) {
                    ctx.clearRect(0, 0, width, height)
                }

                ctx.drawImage(img, 0, 0, width, height)

                canvas.toBlob(
                    (blob) => {
                        if (!blob) return reject(new Error("Compression failed"))
                        const compressedFile = new File([blob], file.name, {
                            type: outputType,
                            lastModified: Date.now(),
                        })
                        resolve(compressedFile)
                    },
                    outputType,
                    isPng ? undefined : 0.9,
                )
            }

            reader.readAsDataURL(file)
        })
    }

    const handleFileUpload = async (file: File) => {
        setUploading(true)

        try {
            let fileToUpload = file
            if (file.type.startsWith("image/")) {
                fileToUpload = await compressImage(file)
            }

            const formData = new FormData()
            formData.append("file", fileToUpload)

            const result = await uploadHashedAsset(formData, currentFolder)

            if (!result.success) {
                console.error("Error uploading file:", result.error)
            } else {
                await fetchAssets()
            }
        } catch (e) {
            console.error("Upload process failed:", e)
        }
        setUploading(false)
    }

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragOver(true)
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragOver(false)
    }, [])

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault()
            setIsDragOver(false)
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleFileUpload(e.dataTransfer.files[0])
            }
        },
        [currentFolder],
    )

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            handleFileUpload(e.target.files[0])
        }
    }

    const handleSelect = () => {
        if (selectedAsset) {
            setCroppingAsset(selectedAsset)
        }
    }

    const handleCropComplete = async (blob: Blob) => {
        if (!croppingAsset) return
        setUploading(true)

        try {
            const fileName = `cropped-${Date.now()}-${croppingAsset.filename}`
            const file = new File([blob], fileName, { type: "image/jpeg" })

            const formData = new FormData()
            formData.append("file", file)

            const result = await uploadHashedAsset(formData, currentFolder)

            if (!result.success) {
                console.error("Error uploading cropped asset:", result.error)
            } else if (result.asset) {
                onSelect(result.asset.public_url)
                onClose()
            }
        } catch (e) {
            console.error("Crop upload failed:", e)
        }
        setUploading(false)
        setCroppingAsset(null)
    }

    const handleSkipCrop = () => {
        if (croppingAsset) {
            onSelect(croppingAsset.public_url)
            onClose()
        }
    }

    const handleDeleteAsset = async (e: React.MouseEvent, asset: Asset) => {
        e.stopPropagation()
        if (!confirm(`Delete "${asset.filename}"? It will be hidden but existing email links stay intact.`)) return

        setDeleting(asset.id)
        const result = await deleteAsset(asset.id)

        if (!result.success) {
            console.error("Error deleting asset:", result.error)
        } else {
            if (selectedAsset?.id === asset.id) {
                setSelectedAsset(null)
            }
            multiSelectedIds.delete(asset.id)
            setMultiSelectedIds(new Set(multiSelectedIds))
            await fetchAssets()
        }
        setDeleting(null)
    }

    const handleDeleteFolder = async (e: React.MouseEvent, folderName: string) => {
        e.stopPropagation()
        if (!confirm(`Delete folder "${folderName}" and hide all its contents?`)) return

        setDeleting(folderName)
        const fullPath = currentFolder ? `${currentFolder}/${folderName}` : folderName
        const result = await deleteFolder(fullPath)

        if (!result.success) {
            console.error("Error deleting folder:", result.error)
        } else {
            await fetchAssets()
        }
        setDeleting(null)
    }

    const handleCreateFolder = async () => {
        const name = newFolderName.trim()
        if (!name) return

        setCreatingFolderLoading(true)
        const fullPath = currentFolder ? `${currentFolder}/${name}` : name
        const result = await createFolder(fullPath)

        if (!result.success) {
            console.error("Error creating folder:", result.error)
        } else {
            setCreatingFolder(false)
            setNewFolderName("")
            await fetchAssets()
        }
        setCreatingFolderLoading(false)
    }

    const navigateToFolder = (folderName: string) => {
        setCurrentFolder((prev) => (prev ? `${prev}/${folderName}` : folderName))
    }

    const navigateToRoot = () => {
        setCurrentFolder("")
    }

    const navigateToBreadcrumb = (index: number) => {
        const parts = currentFolder.split("/")
        setCurrentFolder(parts.slice(0, index + 1).join("/"))
    }

    const formatFileSize = (bytes?: number) => {
        if (!bytes) return "—"
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    // ─── Drag & Drop: Move assets into folders ───
    const handleAssetDragStart = (e: React.DragEvent, asset: Asset) => {
        e.dataTransfer.setData("text/plain", asset.id)
        e.dataTransfer.effectAllowed = "move"
        setMovingAsset(asset.id)
    }

    const handleAssetDragEnd = () => {
        setMovingAsset(null)
        setDropTargetFolder(null)
    }

    const handleFolderDragOver = (e: React.DragEvent, folderName: string) => {
        if (!movingAsset) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        setDropTargetFolder(folderName)
    }

    const handleFolderDragLeave = () => {
        setDropTargetFolder(null)
    }

    const handleFolderDrop = async (e: React.DragEvent, folderName: string) => {
        e.preventDefault()
        setDropTargetFolder(null)
        const assetId = e.dataTransfer.getData("text/plain")
        if (!assetId) return

        setMovingAsset(assetId)
        const targetPath = currentFolder ? `${currentFolder}/${folderName}` : folderName

        const result = await moveAsset(assetId, targetPath)
        if (!result.success) {
            console.error("Error moving asset:", result.error)
        } else {
            await fetchAssets()
        }
        setMovingAsset(null)
    }

    // Handle click on asset — multi-select mode vs single-select mode
    const handleAssetClick = (asset: Asset, e: React.MouseEvent) => {
        if (isMultiSelectMode) {
            toggleMultiSelect(asset.id, e)
        } else {
            setSelectedAsset(asset)
        }
    }

    if (!isOpen) return null

    const breadcrumbParts = currentFolder ? currentFolder.split("/") : []

    // Filter out current folder from move targets
    const moveTargetFolders = allFolders.filter(f => {
        if (currentFolder === "") return true // show all folders when at root
        return f !== currentFolder.split("/")[0] // exclude current root folder
    })

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="w-full max-w-2xl mx-4 rounded-lg bg-[#111111] border border-neutral-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 flex-shrink-0">
                    <h3 className="text-lg font-medium text-neutral-100">
                        {croppingAsset ? "Adjust Image" : "Select Image Asset"}
                    </h3>
                    <div className="flex items-center gap-2">
                        {!croppingAsset && (
                            <>
                                <button
                                    onClick={() => setViewMode("grid")}
                                    className={cn(
                                        "p-1.5 rounded-md transition-colors",
                                        viewMode === "grid"
                                            ? "bg-neutral-700 text-neutral-100"
                                            : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800",
                                    )}
                                    title="Grid view"
                                >
                                    <LayoutGrid className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => setViewMode("list")}
                                    className={cn(
                                        "p-1.5 rounded-md transition-colors",
                                        viewMode === "list"
                                            ? "bg-neutral-700 text-neutral-100"
                                            : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800",
                                    )}
                                    title="List view"
                                >
                                    <List className="w-4 h-4" />
                                </button>
                            </>
                        )}
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 overflow-hidden flex flex-col">
                    {croppingAsset ? (
                        <div className="flex-1 p-6 overflow-hidden">
                            <ImageCropper
                                src={croppingAsset.public_url}
                                onCropComplete={handleCropComplete}
                                onCancel={() => setCroppingAsset(null)}
                                onSkip={handleSkipCrop}
                            />
                        </div>
                    ) : (
                        <div className="p-6 space-y-4 overflow-y-auto">
                            {/* Breadcrumb Navigation */}
                            <div className="flex items-center gap-1 text-sm flex-wrap">
                                <button
                                    onClick={navigateToRoot}
                                    className={cn(
                                        "flex items-center gap-1 px-2 py-1 rounded-md transition-colors",
                                        currentFolder
                                            ? "text-neutral-400 hover:text-amber-400 hover:bg-neutral-800"
                                            : "text-amber-400 bg-neutral-800/50",
                                    )}
                                >
                                    <Home className="w-3.5 h-3.5" />
                                    All Assets
                                </button>
                                {breadcrumbParts.map((part, i) => (
                                    <div key={i} className="flex items-center gap-1">
                                        <ChevronRight className="w-3.5 h-3.5 text-neutral-600" />
                                        <button
                                            onClick={() => navigateToBreadcrumb(i)}
                                            className={cn(
                                                "px-2 py-1 rounded-md transition-colors",
                                                i === breadcrumbParts.length - 1
                                                    ? "text-amber-400 bg-neutral-800/50"
                                                    : "text-neutral-400 hover:text-amber-400 hover:bg-neutral-800",
                                            )}
                                        >
                                            {part}
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {/* Upload Zone + New Folder */}
                            <div className="flex gap-3">
                                <div
                                    onDragOver={handleDragOver}
                                    onDragLeave={handleDragLeave}
                                    onDrop={handleDrop}
                                    onClick={() => document.getElementById("file-upload")?.click()}
                                    className={cn(
                                        "flex-1 flex items-center justify-center gap-3 py-6 rounded-lg border-2 border-dashed transition-colors cursor-pointer",
                                        isDragOver
                                            ? "border-amber-500 bg-amber-500/5"
                                            : "border-neutral-700 hover:border-amber-500 hover:bg-amber-500/5",
                                    )}
                                >
                                    <input
                                        id="file-upload"
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleFileSelect}
                                    />
                                    {uploading ? (
                                        <Loader2 className="w-6 h-6 text-amber-500 animate-spin" />
                                    ) : (
                                        <Upload className={cn("w-6 h-6", isDragOver ? "text-amber-500" : "text-neutral-500")} />
                                    )}
                                    <p className="text-sm text-neutral-400">
                                        {uploading ? (
                                            "Uploading..."
                                        ) : (
                                            <>
                                                Drop or <span className="text-amber-500 font-medium">upload</span>
                                            </>
                                        )}
                                    </p>
                                </div>
                                <button
                                    onClick={() => setCreatingFolder(true)}
                                    className="flex flex-col items-center justify-center gap-1.5 px-5 py-6 rounded-lg border-2 border-dashed border-neutral-700 hover:border-amber-500 hover:bg-amber-500/5 transition-colors"
                                    title="New Folder"
                                >
                                    <FolderPlus className="w-6 h-6 text-neutral-500" />
                                    <span className="text-xs text-neutral-400">New Folder</span>
                                </button>
                            </div>

                            {/* Inline New Folder Input */}
                            {creatingFolder && (
                                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-700">
                                    <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />
                                    <input
                                        autoFocus
                                        value={newFolderName}
                                        onChange={(e) => setNewFolderName(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") handleCreateFolder()
                                            if (e.key === "Escape") {
                                                setCreatingFolder(false)
                                                setNewFolderName("")
                                            }
                                        }}
                                        placeholder="Folder name..."
                                        className="flex-1 bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
                                    />
                                    <button
                                        onClick={handleCreateFolder}
                                        disabled={!newFolderName.trim() || creatingFolderLoading}
                                        className="px-3 py-1 text-xs font-medium rounded bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {creatingFolderLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Create"}
                                    </button>
                                    <button
                                        onClick={() => {
                                            setCreatingFolder(false)
                                            setNewFolderName("")
                                        }}
                                        className="p-1 text-neutral-400 hover:text-neutral-100 transition-colors"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            )}

                            {/* Select All Bar (when assets exist) */}
                            {assets.length > 0 && (
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={selectAll}
                                        className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
                                    >
                                        {multiSelectedIds.size === assets.length ? (
                                            <CheckSquare className="w-3.5 h-3.5 text-amber-500" />
                                        ) : (
                                            <Square className="w-3.5 h-3.5" />
                                        )}
                                        {multiSelectedIds.size === assets.length ? "Deselect All" : "Select All"}
                                    </button>
                                    {isMultiSelectMode && (
                                        <span className="text-xs text-amber-400">
                                            {multiSelectedIds.size} selected
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* Content Area */}
                            <div className="max-h-[400px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-neutral-700 scrollbar-track-transparent">
                                {loading ? (
                                    <div className="flex justify-center py-12">
                                        <Loader2 className="w-8 h-8 text-neutral-500 animate-spin" />
                                    </div>
                                ) : folders.length === 0 && assets.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-16 text-center">
                                        <ImageIcon className="w-12 h-12 text-neutral-600 mb-3" />
                                        <p className="text-neutral-500">
                                            {currentFolder ? "This folder is empty." : "No assets found. Upload one to get started."}
                                        </p>
                                    </div>
                                ) : viewMode === "grid" ? (
                                    /* ─── Grid View ─── */
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                        {/* Folders first */}
                                        {folders.map((folder) => (
                                            <button
                                                key={`folder-${folder.name}`}
                                                onClick={() => navigateToFolder(folder.name)}
                                                onDragOver={(e) => handleFolderDragOver(e, folder.name)}
                                                onDragLeave={handleFolderDragLeave}
                                                onDrop={(e) => handleFolderDrop(e, folder.name)}
                                                className={cn(
                                                    "group relative aspect-square rounded-md overflow-hidden bg-neutral-900 border-2 transition-all flex flex-col items-center justify-center gap-2",
                                                    dropTargetFolder === folder.name
                                                        ? "border-amber-500 bg-amber-500/10 scale-105"
                                                        : "border-transparent hover:border-amber-500/50",
                                                )}
                                            >
                                                <Folder className={cn("w-10 h-10", dropTargetFolder === folder.name ? "text-amber-500" : "text-amber-500/70")} />
                                                <p className="text-xs text-neutral-300 truncate px-2 max-w-full">{folder.name}</p>
                                                {/* Delete folder button */}
                                                <button
                                                    onClick={(e) => handleDeleteFolder(e, folder.name)}
                                                    disabled={deleting === folder.name}
                                                    className="absolute top-2 left-2 w-6 h-6 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                                                    title="Delete folder"
                                                >
                                                    {deleting === folder.name ? (
                                                        <Loader2 className="w-3 h-3 text-white animate-spin" />
                                                    ) : (
                                                        <Trash2 className="w-3 h-3 text-white" />
                                                    )}
                                                </button>
                                            </button>
                                        ))}

                                        {/* Image assets */}
                                        {assets.map((asset) => {
                                            const isMultiSelected = multiSelectedIds.has(asset.id)
                                            return (
                                                <button
                                                    key={asset.id}
                                                    draggable={!isMultiSelectMode}
                                                    onDragStart={(e) => handleAssetDragStart(e, asset)}
                                                    onDragEnd={handleAssetDragEnd}
                                                    onClick={(e) => handleAssetClick(asset, e)}
                                                    className={cn(
                                                        "group relative aspect-square rounded-md overflow-hidden bg-neutral-900 border-2 transition-all",
                                                        isMultiSelectMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
                                                        isMultiSelected
                                                            ? "border-amber-500 ring-2 ring-amber-500/30"
                                                            : selectedAsset?.id === asset.id && !isMultiSelectMode
                                                                ? "border-amber-500 ring-2 ring-amber-500/30"
                                                                : "border-transparent hover:border-neutral-600",
                                                        movingAsset === asset.id && "opacity-40",
                                                    )}
                                                >
                                                    <img
                                                        src={asset.public_url || "/placeholder.svg"}
                                                        alt={asset.filename}
                                                        loading="lazy"
                                                        className="w-full h-full object-cover"
                                                    />
                                                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-2">
                                                        <p className="text-xs text-neutral-300 truncate">{asset.filename}</p>
                                                    </div>
                                                    {/* Multi-select checkbox */}
                                                    <button
                                                        onClick={(e) => toggleMultiSelect(asset.id, e)}
                                                        className={cn(
                                                            "absolute top-2 right-2 w-5 h-5 rounded flex items-center justify-center transition-all",
                                                            isMultiSelected
                                                                ? "bg-amber-500"
                                                                : "bg-black/50 border border-neutral-500 opacity-0 group-hover:opacity-100",
                                                        )}
                                                    >
                                                        {isMultiSelected && (
                                                            <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                            </svg>
                                                        )}
                                                    </button>
                                                    {/* Single delete */}
                                                    {!isMultiSelectMode && (
                                                        <button
                                                            onClick={(e) => handleDeleteAsset(e, asset)}
                                                            disabled={deleting === asset.id}
                                                            className="absolute top-2 left-2 w-6 h-6 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                                                            title="Delete asset"
                                                        >
                                                            {deleting === asset.id ? (
                                                                <Loader2 className="w-3 h-3 text-white animate-spin" />
                                                            ) : (
                                                                <Trash2 className="w-3 h-3 text-white" />
                                                            )}
                                                        </button>
                                                    )}
                                                    {/* Single select indicator */}
                                                    {!isMultiSelectMode && selectedAsset?.id === asset.id && (
                                                        <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center">
                                                            <svg
                                                                className="w-3 h-3 text-black"
                                                                fill="none"
                                                                viewBox="0 0 24 24"
                                                                stroke="currentColor"
                                                            >
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                            </svg>
                                                        </div>
                                                    )}
                                                </button>
                                            )
                                        })}
                                    </div>
                                ) : (
                                    /* ─── List View ─── */
                                    <div className="space-y-1">
                                        {/* Folders first */}
                                        {folders.map((folder) => (
                                            <button
                                                key={`folder-${folder.name}`}
                                                onClick={() => navigateToFolder(folder.name)}
                                                onDragOver={(e) => handleFolderDragOver(e, folder.name)}
                                                onDragLeave={handleFolderDragLeave}
                                                onDrop={(e) => handleFolderDrop(e, folder.name)}
                                                className={cn(
                                                    "group w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors text-left",
                                                    dropTargetFolder === folder.name
                                                        ? "bg-amber-500/10 ring-1 ring-amber-500/50"
                                                        : "hover:bg-neutral-800/70",
                                                )}
                                            >
                                                <Folder className={cn("w-5 h-5 flex-shrink-0", dropTargetFolder === folder.name ? "text-amber-500" : "text-amber-500/70")} />
                                                <span className="flex-1 text-sm text-neutral-200 truncate">{folder.name}</span>
                                                <button
                                                    onClick={(e) => handleDeleteFolder(e, folder.name)}
                                                    disabled={deleting === folder.name}
                                                    className="p-1 rounded text-neutral-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                                                    title="Delete folder"
                                                >
                                                    {deleting === folder.name ? (
                                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    ) : (
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    )}
                                                </button>
                                                <ChevronRight className="w-4 h-4 text-neutral-600 flex-shrink-0" />
                                            </button>
                                        ))}

                                        {/* Image assets */}
                                        {assets.map((asset) => {
                                            const isMultiSelected = multiSelectedIds.has(asset.id)
                                            return (
                                                <button
                                                    key={asset.id}
                                                    draggable={!isMultiSelectMode}
                                                    onDragStart={(e) => handleAssetDragStart(e, asset)}
                                                    onDragEnd={handleAssetDragEnd}
                                                    onClick={(e) => handleAssetClick(asset, e)}
                                                    className={cn(
                                                        "group w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-left",
                                                        isMultiSelectMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
                                                        isMultiSelected
                                                            ? "bg-amber-500/10 ring-1 ring-amber-500/30"
                                                            : selectedAsset?.id === asset.id && !isMultiSelectMode
                                                                ? "bg-amber-500/10 ring-1 ring-amber-500/30"
                                                                : "hover:bg-neutral-800/70",
                                                        movingAsset === asset.id && "opacity-40",
                                                    )}
                                                >
                                                    {/* Checkbox */}
                                                    <button
                                                        onClick={(e) => toggleMultiSelect(asset.id, e)}
                                                        className={cn(
                                                            "w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all",
                                                            isMultiSelected
                                                                ? "bg-amber-500"
                                                                : "border border-neutral-600 opacity-0 group-hover:opacity-100",
                                                        )}
                                                    >
                                                        {isMultiSelected && (
                                                            <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                            </svg>
                                                        )}
                                                    </button>
                                                    <div className="w-12 h-12 rounded overflow-hidden bg-neutral-900 flex-shrink-0">
                                                        <img
                                                            src={asset.public_url || "/placeholder.svg"}
                                                            alt={asset.filename}
                                                            loading="lazy"
                                                            className="w-full h-full object-cover"
                                                        />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm text-neutral-200 truncate">{asset.filename}</p>
                                                        <p className="text-xs text-neutral-500">{formatFileSize(asset.size)}</p>
                                                    </div>
                                                    {!isMultiSelectMode && (
                                                        <button
                                                            onClick={(e) => handleDeleteAsset(e, asset)}
                                                            disabled={deleting === asset.id}
                                                            className="p-1 rounded text-neutral-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                                                            title="Delete asset"
                                                        >
                                                            {deleting === asset.id ? (
                                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                            ) : (
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            )}
                                                        </button>
                                                    )}
                                                    {!isMultiSelectMode && selectedAsset?.id === asset.id && (
                                                        <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0">
                                                            <svg
                                                                className="w-3 h-3 text-black"
                                                                fill="none"
                                                                viewBox="0 0 24 24"
                                                                stroke="currentColor"
                                                            >
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                            </svg>
                                                        </div>
                                                    )}
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                {!croppingAsset && (
                    <div className="flex items-center justify-between px-6 py-4 border-t border-neutral-800 flex-shrink-0">
                        <p className="text-sm text-neutral-500">
                            {folders.length > 0 && `${folders.length} folder${folders.length !== 1 ? "s" : ""}, `}
                            {assets.length} asset{assets.length !== 1 ? "s" : ""}
                        </p>
                        <div className="flex items-center gap-2">
                            {isMultiSelectMode ? (
                                /* ─── Bulk Actions ─── */
                                <>
                                    <button
                                        onClick={() => setMultiSelectedIds(new Set())}
                                        className="px-3 py-2 text-sm font-medium text-neutral-300 hover:text-neutral-100 hover:bg-neutral-800 rounded-md transition-colors"
                                    >
                                        Cancel ({multiSelectedIds.size})
                                    </button>
                                    <button
                                        onClick={openMoveDialog}
                                        disabled={bulkMoving}
                                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md bg-neutral-700 text-neutral-100 hover:bg-neutral-600 disabled:opacity-50 transition-colors"
                                    >
                                        <FolderInput className="w-3.5 h-3.5" />
                                        Move to Folder
                                    </button>
                                    <button
                                        onClick={handleBulkDelete}
                                        disabled={bulkDeleting}
                                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 transition-colors"
                                    >
                                        {bulkDeleting ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                            <Trash2 className="w-3.5 h-3.5" />
                                        )}
                                        Delete ({multiSelectedIds.size})
                                    </button>
                                </>
                            ) : (
                                /* ─── Normal Actions ─── */
                                <>
                                    <button
                                        onClick={onClose}
                                        className="px-4 py-2 text-sm font-medium text-neutral-300 hover:text-neutral-100 hover:bg-neutral-800 rounded-md transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSelect}
                                        disabled={!selectedAsset}
                                        className={cn(
                                            "px-4 py-2 text-sm font-medium rounded-md transition-colors",
                                            selectedAsset
                                                ? "bg-amber-500 text-black hover:bg-amber-400"
                                                : "bg-neutral-700 text-neutral-500 cursor-not-allowed",
                                        )}
                                    >
                                        Select & Adjust
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ─── Move to Folder Dialog ─── */}
            {showMoveDialog && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
                    <div className="w-full max-w-sm mx-4 rounded-lg bg-[#1a1a1a] border border-neutral-700 shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-700">
                            <h4 className="text-sm font-medium text-neutral-100">
                                Move {multiSelectedIds.size} asset{multiSelectedIds.size > 1 ? "s" : ""} to…
                            </h4>
                            <button
                                onClick={() => setShowMoveDialog(false)}
                                className="p-1 text-neutral-400 hover:text-neutral-100 transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-3 max-h-[300px] overflow-y-auto space-y-1">
                            {currentFolder && (
                                <button
                                    onClick={() => handleBulkMoveToFolder("")}
                                    disabled={bulkMoving}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-neutral-800 transition-colors text-left disabled:opacity-50"
                                >
                                    <Home className="w-4 h-4 text-amber-500/70" />
                                    <span className="text-sm text-neutral-200">Root (All Assets)</span>
                                </button>
                            )}
                            {moveTargetFolders.length === 0 && !currentFolder ? (
                                <p className="text-sm text-neutral-500 text-center py-6">No folders available. Create one first.</p>
                            ) : (
                                moveTargetFolders.map((folder) => (
                                    <button
                                        key={folder}
                                        onClick={() => handleBulkMoveToFolder(folder)}
                                        disabled={bulkMoving}
                                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-neutral-800 transition-colors text-left disabled:opacity-50"
                                    >
                                        {bulkMoving ? (
                                            <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
                                        ) : (
                                            <Folder className="w-4 h-4 text-amber-500/70" />
                                        )}
                                        <span className="text-sm text-neutral-200">{folder}</span>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
