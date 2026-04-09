import type {
    EmailBlock, EmailDesign, HeadingProps, TextProps, ImageProps,
    ButtonProps, DividerProps, SpacerProps, SocialProps
} from './types'

// ============================================================
// Email HTML Compiler
// Converts EmailBlock[] → email-safe HTML (tables, inline styles)
// ============================================================

// Social platform icon URLs (simple text-based fallback, no external deps)
const SOCIAL_ICONS: Record<string, { label: string; color: string }> = {
    facebook: { label: 'Facebook', color: '#1877F2' },
    instagram: { label: 'Instagram', color: '#E4405F' },
    twitter: { label: 'Twitter', color: '#1DA1F2' },
    youtube: { label: 'YouTube', color: '#FF0000' },
    linkedin: { label: 'LinkedIn', color: '#0A66C2' },
    tiktok: { label: 'TikTok', color: '#000000' },
}

function alignToTd(alignment: string): string {
    return alignment === 'left' ? 'left' : alignment === 'right' ? 'right' : 'center'
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

// --- Individual Block Compilers ---

function compileHeading(props: HeadingProps): string {
    const tag = props.level || 'h1'
    const sizes: Record<string, string> = { h1: '28px', h2: '22px', h3: '18px' }
    return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td align="${alignToTd(props.alignment)}" style="padding: 10px 20px;">
      <${tag} style="margin: 0; font-size: ${sizes[tag]}; color: ${props.color}; font-family: ${props.fontFamily}; font-weight: bold;">
        ${props.text}
      </${tag}>
    </td>
  </tr>
</table>`
}

function compileText(props: TextProps): string {
    // Convert newlines to <br> for multiline text
    const htmlText = props.text.replace(/\n/g, '<br>')
    return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td align="${alignToTd(props.alignment)}" style="padding: 10px 20px; font-size: ${props.fontSize}px; line-height: ${props.lineHeight}; color: ${props.color}; font-family: Arial, Helvetica, sans-serif;">
      ${htmlText}
    </td>
  </tr>
</table>`
}

function compileImage(props: ImageProps): string {
    const widthAttr = props.width ? `width="${props.width}"` : 'width="600"'
    const heightStyle = props.height === 'auto' ? 'height: auto;' : `height: ${props.height}px;`
    const imgTag = `<img src="${props.src}" alt="${escapeHtml(props.alt)}" ${widthAttr} style="display: block; max-width: 100%; ${heightStyle} border: 0; outline: none;" />`
    const content = props.linkUrl ? `<a href="${props.linkUrl}" target="_blank" style="display: inline-block;">${imgTag}</a>` : imgTag

    return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td align="${alignToTd(props.alignment)}" style="padding: 0;">
      ${content}
    </td>
  </tr>
</table>`
}

function compileButton(props: ButtonProps): string {
    const widthStyle = props.fullWidth ? 'display: block; width: 100%;' : 'display: inline-block;'
    return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td align="${alignToTd(props.alignment)}" style="padding: 10px 20px;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${props.url}" style="height:${props.paddingY * 2 + props.fontSize + 4}px;v-text-anchor:middle;width:${props.fullWidth ? 560 : 'auto'};" arcsize="${Math.round((props.borderRadius / 40) * 100)}%" strokecolor="${props.bgColor}" fillcolor="${props.bgColor}">
        <w:anchorlock/>
        <center style="color:${props.textColor};font-family:Arial,sans-serif;font-size:${props.fontSize}px;font-weight:bold;">${escapeHtml(props.text)}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${props.url}" target="_blank" style="${widthStyle} padding: ${props.paddingY}px ${props.paddingX}px; background-color: ${props.bgColor}; color: ${props.textColor}; font-family: Arial, Helvetica, sans-serif; font-size: ${props.fontSize}px; font-weight: bold; text-decoration: none; text-align: center; border-radius: ${props.borderRadius}px; mso-hide: all;">
        ${escapeHtml(props.text)}
      </a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`
}

function compileDivider(props: DividerProps): string {
    return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td align="center" style="padding: 10px 20px;">
      <table role="presentation" width="${props.widthPercent}%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="border-top: ${props.thickness}px ${props.style} ${props.color}; font-size: 1px; line-height: 1px;">&nbsp;</td>
        </tr>
      </table>
    </td>
  </tr>
</table>`
}

function compileSpacer(props: SpacerProps): string {
    return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="height: ${props.height}px; font-size: 1px; line-height: 1px;">&nbsp;</td>
  </tr>
</table>`
}

function compileSocial(props: SocialProps): string {
    const icons = props.networks.map(n => {
        const info = SOCIAL_ICONS[n.platform] || { label: n.platform, color: '#333' }
        return `<td style="padding: 0 6px;">
          <a href="${n.url}" target="_blank" style="text-decoration: none;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="width: ${props.iconSize}px; height: ${props.iconSize}px; background-color: ${info.color}; border-radius: 50%; text-align: center; vertical-align: middle;">
                  <span style="color: #ffffff; font-size: ${Math.round(props.iconSize * 0.4)}px; font-family: Arial, sans-serif; font-weight: bold; line-height: ${props.iconSize}px;">${info.label.charAt(0)}</span>
                </td>
              </tr>
            </table>
          </a>
        </td>`
    }).join('\n')

    return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td align="${alignToTd(props.alignment)}" style="padding: 10px 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${icons}
        </tr>
      </table>
    </td>
  </tr>
</table>`
}

// --- Main Compiler ---

function compileBlock(block: EmailBlock): string {
    switch (block.type) {
        case 'heading': return compileHeading(block.props as HeadingProps)
        case 'text': return compileText(block.props as TextProps)
        case 'image': return compileImage(block.props as ImageProps)
        case 'button': return compileButton(block.props as ButtonProps)
        case 'divider': return compileDivider(block.props as DividerProps)
        case 'spacer': return compileSpacer(block.props as SpacerProps)
        case 'social': return compileSocial(block.props as SocialProps)
        default: return `<!-- unknown block type: ${(block as any).type} -->`
    }
}

export function compileBlocksToHtml(blocks: EmailDesign): string {
    const bodyContent = blocks.map(compileBlock).join('\n')

    return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <!--[if !mso]><!-->
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <!--<![endif]-->
  <title>Email</title>
  <style type="text/css">
    /* Reset */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; height: 100% !important; }
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .email-container td { padding-left: 10px !important; padding-right: 10px !important; }
      .email-container img { width: 100% !important; height: auto !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f7; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f7;">
    <tr>
      <td align="center" style="padding: 20px 0;">
        <!--[if mso]>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"><tr><td>
        <![endif]-->
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; background-color: #ffffff;">
          <tr>
            <td>
${bodyContent}
            </td>
          </tr>
        </table>
        <!--[if mso]>
        </td></tr></table>
        <![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`
}
