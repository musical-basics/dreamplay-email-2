"use client"

import { useState, useCallback, useEffect } from "react"
import { Upload, ImageIcon, Loader2, Trash2, Folder, Home, ChevronRight, LayoutGrid, List, CheckSquare, Square, FolderInput } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { deleteAsset, deleteAssets, moveAsset, moveAssets, getAssets, getFolders, getSubFolders, uploadHashedAsset, createFolder, deleteFolder } from "@/app/actions/assets"

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

type ViewMode = "grid" | "list"

export default function AssetsPage() {
    const [assets, setAssets] = useState<Asset[]>([])
    const [folders, setFolders] = useState<FolderItem[]>([])
    const [loading, setLoading] = useState(true)
    const [uploading, setUploading] = useState(false)
    const [deleting, setDeleting] = useState<string | null>(null)
    const [isDragOver, setIsDragOver] = useState(false)
    const [currentFolder, setCurrentFolder] = useState("")
    const [viewMode, setViewMode] = useState<ViewMode>("grid")

    // ─── Multi-Select State ───
    const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set())
    const [bulkDeleting, setBulkDeleting] = useState(false)
    const [bulkMoving, setBulkMoving] = useState(false)
    const [showMoveDialog, setShowMoveDialog] = useState(false)
    const [allFolders, setAllFolders] = useState<string[]>([])

    // ─── Drag-to-Folder State ───
    const [movingAsset, setMovingAsset] = useState<string | null>(null)
    const [dropTargetFolder, setDropTargetFolder] = useState<string | null>(null)

    const isMultiSelectMode = multiSelectedIds.size > 0

    // ─── Fetch assets from DB ───
    const fetchAssets = useCallback(async () => {
        setLoading(true)

        // Fetch assets in the current folder
        const { assets: dbAssets } = await getAssets(currentFolder)
        // Filter out sentinel .folder records
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
        fetchAssets()
    }, [fetchAssets])

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
        if (!confirm(`Delete ${selected.length} asset${selected.length > 1 ? "s" : ""}? This will hide them from the library.`)) return

        setBulkDeleting(true)
        const ids = selected.map(a => a.id)
        const result = await deleteAssets(ids)

        if (!result.success) {
            console.error("Error bulk deleting:", result.error)
        } else {
            setMultiSelectedIds(new Set())
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

    // Compress Image using Canvas
    const compressImage = async (file: File): Promise<File> => {
        return new Promise((resolve, reject) => {
            const img = new Image()
            const reader = new FileReader()

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
                ctx.drawImage(img, 0, 0, width, height)

                canvas.toBlob(
                    (blob) => {
                        if (!blob) return reject(new Error("Compression failed"))
                        const compressedFile = new File([blob], file.name, {
                            type: "image/jpeg",
                            lastModified: Date.now(),
                        })
                        resolve(compressedFile)
                    },
                    "image/jpeg",
                    0.9,
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

    const handleDelete = async (asset: Asset) => {
        if (!confirm(`Delete "${asset.filename}"? It will be hidden from the library but existing email links stay intact.`)) return

        setDeleting(asset.id)
        const result = await deleteAsset(asset.id)

        if (!result.success) {
            console.error("Error deleting asset:", result.error)
        } else {
            multiSelectedIds.delete(asset.id)
            setMultiSelectedIds(new Set(multiSelectedIds))
            await fetchAssets()
        }
        setDeleting(null)
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
        [],
    )

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            handleFileUpload(e.target.files[0])
        }
    }

    const formatFileSize = (bytes?: number) => {
        if (!bytes) return "Unknown"
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

    const breadcrumbParts = currentFolder ? currentFolder.split("/") : []

    // Filter out current folder from move targets
    const moveTargetFolders = allFolders.filter(f => {
        if (currentFolder === "") return true
        return f !== currentFolder.split("/")[0]
    })

    return (
        <div className="p-6">
            <div className="mb-6">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Assets Library</h1>
                <p className="text-muted-foreground">Manage your email images and assets</p>
            </div>

            <Card className="mb-6">
                <CardHeader>
                    <CardTitle>Upload New Asset</CardTitle>
                    <CardDescription>Images are automatically compressed for optimal email delivery</CardDescription>
                </CardHeader>
                <CardContent>
                    <div
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => document.getElementById("asset-upload")?.click()}
                        className={cn(
                            "flex flex-col items-center justify-center gap-3 py-12 rounded-lg border-2 border-dashed transition-colors cursor-pointer",
                            isDragOver
                                ? "border-primary bg-primary/5"
                                : "border-muted-foreground/25 hover:border-primary hover:bg-primary/5",
                        )}
                    >
                        <input
                            id="asset-upload"
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleFileSelect}
                        />
                        {uploading ? (
                            <Loader2 className="w-10 h-10 text-primary animate-spin" />
                        ) : (
                            <Upload className={cn("w-10 h-10", isDragOver ? "text-primary" : "text-muted-foreground")} />
                        )}
                        <p className="text-sm text-muted-foreground">
                            {uploading ? (
                                "Uploading..."
                            ) : (
                                <>
                                    Drag & drop or <span className="text-primary font-medium">click to upload</span>
                                </>
                            )}
                        </p>
                    </div>
                </CardContent>
            </Card>

            {/* Breadcrumb Navigation */}
            {currentFolder && (
                <div className="flex items-center gap-1 text-sm flex-wrap mb-4">
                    <button
                        onClick={navigateToRoot}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                        <Home className="w-3.5 h-3.5" />
                        All Assets
                    </button>
                    {breadcrumbParts.map((part, i) => (
                        <div key={i} className="flex items-center gap-1">
                            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                            <button
                                onClick={() => navigateToBreadcrumb(i)}
                                className={cn(
                                    "px-2 py-1 rounded-md transition-colors",
                                    i === breadcrumbParts.length - 1
                                        ? "text-foreground font-medium"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted",
                                )}
                            >
                                {part}
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>Your Assets</CardTitle>
                            <CardDescription>
                                {folders.length > 0 && `${folders.length} folder${folders.length !== 1 ? "s" : ""}, `}
                                {assets.length} asset{assets.length !== 1 ? "s" : ""}
                            </CardDescription>
                        </div>
                        {/* View Mode Toggle */}
                        <div className="flex items-center gap-1 border border-border rounded-lg p-1">
                            <button
                                onClick={() => setViewMode("grid")}
                                className={cn(
                                    "p-1.5 rounded-md transition-colors",
                                    viewMode === "grid"
                                        ? "bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted",
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
                                        ? "bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted",
                                )}
                                title="List view"
                            >
                                <List className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Select All + Bulk Actions Bar */}
                    {assets.length > 0 && (
                        <div className="flex items-center gap-3 pt-2">
                            <button
                                onClick={selectAll}
                                className="flex items-center gap-1.5 px-2 py-1 text-sm rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            >
                                {multiSelectedIds.size === assets.length ? (
                                    <CheckSquare className="w-4 h-4 text-primary" />
                                ) : (
                                    <Square className="w-4 h-4" />
                                )}
                                {multiSelectedIds.size === assets.length ? "Deselect All" : "Select All"}
                            </button>
                            {isMultiSelectMode && (
                                <>
                                    <span className="text-sm text-primary font-medium">
                                        {multiSelectedIds.size} selected
                                    </span>
                                    <div className="flex items-center gap-2 ml-auto">
                                        <button
                                            onClick={openMoveDialog}
                                            disabled={bulkMoving}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-muted hover:bg-muted/80 text-foreground transition-colors disabled:opacity-50"
                                        >
                                            {bulkMoving ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                                <FolderInput className="w-3.5 h-3.5" />
                                            )}
                                            Move to…
                                        </button>
                                        <button
                                            onClick={handleBulkDelete}
                                            disabled={bulkDeleting}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
                                        >
                                            {bulkDeleting ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                                <Trash2 className="w-3.5 h-3.5" />
                                            )}
                                            Delete ({multiSelectedIds.size})
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
                        </div>
                    ) : folders.length === 0 && assets.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                            <ImageIcon className="w-12 h-12 text-muted-foreground mb-3" />
                            <p className="text-muted-foreground">
                                {currentFolder ? "This folder is empty." : "No assets found. Upload one to get started."}
                            </p>
                        </div>
                    ) : viewMode === "grid" ? (
                        /* ─── Grid View ─── */
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                            {/* Folders */}
                            {folders.map((folder) => (
                                <button
                                    key={`folder-${folder.name}`}
                                    onClick={() => navigateToFolder(folder.name)}
                                    onDragOver={(e) => handleFolderDragOver(e, folder.name)}
                                    onDragLeave={handleFolderDragLeave}
                                    onDrop={(e) => handleFolderDrop(e, folder.name)}
                                    className={cn(
                                        "group relative aspect-square rounded-lg overflow-hidden bg-muted border-2 transition-all flex flex-col items-center justify-center gap-2",
                                        dropTargetFolder === folder.name
                                            ? "border-primary bg-primary/10 scale-105"
                                            : "border-border hover:border-primary/50",
                                    )}
                                >
                                    <Folder className={cn("w-12 h-12", dropTargetFolder === folder.name ? "text-primary" : "text-primary/70")} />
                                    <p className="text-sm text-foreground truncate px-2 max-w-full">{folder.name}</p>
                                </button>
                            ))}

                            {/* Image Assets */}
                            {assets.map((asset) => {
                                const isSelected = multiSelectedIds.has(asset.id)
                                return (
                                    <div
                                        key={asset.id}
                                        draggable={!isMultiSelectMode}
                                        onDragStart={(e) => handleAssetDragStart(e, asset)}
                                        onDragEnd={handleAssetDragEnd}
                                        className={cn(
                                            "group relative aspect-square rounded-lg overflow-hidden bg-muted border-2 transition-all",
                                            isMultiSelectMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
                                            isSelected
                                                ? "border-primary ring-2 ring-primary/30"
                                                : "border-border hover:border-muted-foreground/50",
                                            movingAsset === asset.id && "opacity-40",
                                        )}
                                        onClick={() => toggleMultiSelect(asset.id)}
                                    >
                                        <img
                                            src={asset.public_url || "/placeholder.svg"}
                                            alt={asset.filename}
                                            className="w-full h-full object-cover"
                                        />
                                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-2">
                                            <p className="text-xs text-white truncate">{asset.filename}</p>
                                            <p className="text-xs text-white/60">{formatFileSize(asset.size)}</p>
                                        </div>
                                        {/* Checkbox */}
                                        <div
                                            className={cn(
                                                "absolute top-2 left-2 w-5 h-5 rounded flex items-center justify-center transition-all",
                                                isSelected
                                                    ? "bg-primary"
                                                    : "bg-black/50 border border-white/40 opacity-0 group-hover:opacity-100",
                                            )}
                                        >
                                            {isSelected && (
                                                <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                        </div>
                                        {/* Single delete */}
                                        {!isMultiSelectMode && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    handleDelete(asset)
                                                }}
                                                disabled={deleting === asset.id}
                                                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                                                title="Delete asset"
                                            >
                                                {deleting === asset.id ? (
                                                    <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                                                ) : (
                                                    <Trash2 className="w-3.5 h-3.5 text-white" />
                                                )}
                                            </button>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        /* ─── List View ─── */
                        <div className="divide-y divide-border">
                            {/* Folder rows */}
                            {folders.map((folder) => (
                                <button
                                    key={`folder-${folder.name}`}
                                    onClick={() => navigateToFolder(folder.name)}
                                    onDragOver={(e) => handleFolderDragOver(e, folder.name)}
                                    onDragLeave={handleFolderDragLeave}
                                    onDrop={(e) => handleFolderDrop(e, folder.name)}
                                    className={cn(
                                        "w-full flex items-center gap-4 px-4 py-3 transition-colors text-left",
                                        dropTargetFolder === folder.name
                                            ? "bg-primary/10 border-l-2 border-primary"
                                            : "hover:bg-muted/50",
                                    )}
                                >
                                    <Folder className={cn("w-8 h-8 flex-shrink-0", dropTargetFolder === folder.name ? "text-primary" : "text-primary/70")} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-foreground truncate">{folder.name}</p>
                                        <p className="text-xs text-muted-foreground">Folder</p>
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                </button>
                            ))}

                            {/* Asset rows */}
                            {assets.map((asset) => {
                                const isSelected = multiSelectedIds.has(asset.id)
                                return (
                                    <div
                                        key={asset.id}
                                        draggable={!isMultiSelectMode}
                                        onDragStart={(e) => handleAssetDragStart(e, asset)}
                                        onDragEnd={handleAssetDragEnd}
                                        className={cn(
                                            "flex items-center gap-4 px-4 py-3 transition-colors",
                                            isMultiSelectMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
                                            isSelected ? "bg-primary/5" : "hover:bg-muted/50",
                                            movingAsset === asset.id && "opacity-40",
                                        )}
                                        onClick={() => toggleMultiSelect(asset.id)}
                                    >
                                        {/* Checkbox */}
                                        <div
                                            className={cn(
                                                "w-5 h-5 rounded flex-shrink-0 flex items-center justify-center transition-all border",
                                                isSelected
                                                    ? "bg-primary border-primary"
                                                    : "border-muted-foreground/30 hover:border-muted-foreground",
                                            )}
                                        >
                                            {isSelected && (
                                                <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                        </div>
                                        {/* Thumbnail */}
                                        <div className="w-12 h-12 rounded-md overflow-hidden bg-muted flex-shrink-0">
                                            <img
                                                src={asset.public_url || "/placeholder.svg"}
                                                alt={asset.filename}
                                                className="w-full h-full object-cover"
                                            />
                                        </div>
                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-foreground truncate">{asset.filename}</p>
                                            <p className="text-xs text-muted-foreground">{formatFileSize(asset.size)}</p>
                                        </div>
                                        {/* Delete */}
                                        {!isMultiSelectMode && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    handleDelete(asset)
                                                }}
                                                disabled={deleting === asset.id}
                                                className="p-2 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                                title="Delete asset"
                                            >
                                                {deleting === asset.id ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <Trash2 className="w-4 h-4" />
                                                )}
                                            </button>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ─── Move to Folder Dialog ─── */}
            {showMoveDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-sm mx-4 rounded-lg bg-card border border-border shadow-2xl overflow-hidden">
                        <div className="px-5 py-4 border-b border-border">
                            <h3 className="text-base font-medium text-foreground">Move {multiSelectedIds.size} asset{multiSelectedIds.size > 1 ? "s" : ""} to…</h3>
                        </div>
                        <div className="px-5 py-3 max-h-60 overflow-y-auto">
                            {currentFolder && (
                                <button
                                    onClick={() => handleBulkMoveToFolder("")}
                                    disabled={bulkMoving}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-muted transition-colors text-left"
                                >
                                    <Home className="w-4 h-4 text-muted-foreground" />
                                    <span className="text-sm text-foreground">Root</span>
                                </button>
                            )}
                            {moveTargetFolders.length === 0 && !currentFolder ? (
                                <p className="text-sm text-muted-foreground py-4 text-center">No folders available</p>
                            ) : (
                                moveTargetFolders.map(folder => (
                                    <button
                                        key={folder}
                                        onClick={() => handleBulkMoveToFolder(folder)}
                                        disabled={bulkMoving}
                                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-muted transition-colors text-left disabled:opacity-50"
                                    >
                                        <Folder className="w-4 h-4 text-primary/70" />
                                        <span className="text-sm text-foreground">{folder}</span>
                                    </button>
                                ))
                            )}
                        </div>
                        <div className="px-5 py-3 border-t border-border flex justify-end">
                            <button
                                onClick={() => setShowMoveDialog(false)}
                                className="px-4 py-2 text-sm rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
