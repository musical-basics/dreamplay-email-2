// ============================================================
// DnD Email Editor — Block Type Definitions
// ============================================================

export type BlockType = 'heading' | 'text' | 'image' | 'button' | 'divider' | 'spacer' | 'social'

// --- Per-Block Props ---

export interface HeadingProps {
    text: string
    level: 'h1' | 'h2' | 'h3'
    alignment: 'left' | 'center' | 'right'
    color: string
    fontFamily: string
}

export interface TextProps {
    text: string
    alignment: 'left' | 'center' | 'right'
    color: string
    fontSize: number
    lineHeight: number
}

export interface ImageProps {
    src: string          // mustache var like {{hero_src}}
    alt: string
    width: number        // px, max 600
    height: 'auto' | number
    linkUrl: string      // mustache var like {{hero_link_url}}
    alignment: 'left' | 'center' | 'right'
}

export interface ButtonProps {
    text: string
    url: string          // mustache var like {{cta_link_url}}
    bgColor: string
    textColor: string
    borderRadius: number
    alignment: 'left' | 'center' | 'right'
    fullWidth: boolean
    fontSize: number
    paddingX: number
    paddingY: number
}

export interface DividerProps {
    color: string
    thickness: number
    widthPercent: number
    style: 'solid' | 'dashed' | 'dotted'
}

export interface SpacerProps {
    height: number
}

export interface SocialNetwork {
    platform: 'facebook' | 'instagram' | 'twitter' | 'youtube' | 'linkedin' | 'tiktok'
    url: string
}

export interface SocialProps {
    networks: SocialNetwork[]
    alignment: 'left' | 'center' | 'right'
    iconSize: number
}

// --- Union Block Type ---

export type BlockPropsMap = {
    heading: HeadingProps
    text: TextProps
    image: ImageProps
    button: ButtonProps
    divider: DividerProps
    spacer: SpacerProps
    social: SocialProps
}

export interface EmailBlock<T extends BlockType = BlockType> {
    id: string
    type: T
    props: BlockPropsMap[T]
}

// --- Design (array of blocks) ---

export type EmailDesign = EmailBlock[]

// --- Marker for JSON storage ---
// When we store block JSON in the campaigns table, we prefix it
// with this marker so the system can distinguish DnD data from raw HTML.
export const DND_META_MARKER = '__dnd_blocks__'

export interface DndCampaignData {
    _marker: typeof DND_META_MARKER
    blocks: EmailDesign
}

export function isDndCampaignData(data: unknown): data is DndCampaignData {
    return (
        typeof data === 'object' &&
        data !== null &&
        '_marker' in data &&
        (data as any)._marker === DND_META_MARKER
    )
}

export function serializeBlocks(blocks: EmailDesign): string {
    const data: DndCampaignData = { _marker: DND_META_MARKER, blocks }
    return JSON.stringify(data)
}

export function deserializeBlocks(raw: string): EmailDesign | null {
    try {
        const parsed = JSON.parse(raw)
        if (isDndCampaignData(parsed)) return parsed.blocks
        return null
    } catch {
        return null
    }
}
