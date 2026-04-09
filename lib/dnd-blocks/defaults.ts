import type {
    BlockType, BlockPropsMap, HeadingProps, TextProps, ImageProps,
    ButtonProps, DividerProps, SpacerProps, SocialProps
} from './types'

// Default props for each block type — used when creating a new block from the palette.

const headingDefaults: HeadingProps = {
    text: 'Your Heading Here',
    level: 'h1',
    alignment: 'center',
    color: '#1a1a1a',
    fontFamily: 'Arial, Helvetica, sans-serif',
}

const textDefaults: TextProps = {
    text: 'Write your email copy here. Keep it concise and compelling.',
    alignment: 'left',
    color: '#444444',
    fontSize: 16,
    lineHeight: 1.6,
}

const imageDefaults: ImageProps = {
    src: '{{hero_src}}',
    alt: 'Email hero image',
    width: 600,
    height: 'auto',
    linkUrl: '{{hero_link_url}}',
    alignment: 'center',
}

const buttonDefaults: ButtonProps = {
    text: 'Shop Now',
    url: '{{cta_link_url}}',
    bgColor: '#2563eb',
    textColor: '#ffffff',
    borderRadius: 6,
    alignment: 'center',
    fullWidth: false,
    fontSize: 16,
    paddingX: 32,
    paddingY: 14,
}

const dividerDefaults: DividerProps = {
    color: '#e5e7eb',
    thickness: 1,
    widthPercent: 100,
    style: 'solid',
}

const spacerDefaults: SpacerProps = {
    height: 24,
}

const socialDefaults: SocialProps = {
    networks: [
        { platform: 'facebook', url: 'https://facebook.com' },
        { platform: 'instagram', url: 'https://instagram.com' },
        { platform: 'youtube', url: 'https://youtube.com' },
    ],
    alignment: 'center',
    iconSize: 32,
}

export const BLOCK_DEFAULTS: { [K in BlockType]: BlockPropsMap[K] } = {
    heading: headingDefaults,
    text: textDefaults,
    image: imageDefaults,
    button: buttonDefaults,
    divider: dividerDefaults,
    spacer: spacerDefaults,
    social: socialDefaults,
}

// Human-readable labels for the palette
export const BLOCK_LABELS: Record<BlockType, string> = {
    heading: 'Heading',
    text: 'Text Block',
    image: 'Image',
    button: 'Button',
    divider: 'Divider',
    spacer: 'Spacer',
    social: 'Social Links',
}

export const BLOCK_DESCRIPTIONS: Record<BlockType, string> = {
    heading: 'Large title or section header',
    text: 'Paragraph of body copy',
    image: 'Full-width or centered image',
    button: 'Call-to-action button',
    divider: 'Horizontal line separator',
    spacer: 'Empty vertical space',
    social: 'Social media icon row',
}
