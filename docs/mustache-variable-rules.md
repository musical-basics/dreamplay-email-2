# Email Editor: Mustache Variable Rules

This document describes how `{{variable_name}}` placeholders in email HTML templates
are interpreted by the Asset Loader sidebar. AI agents authoring email HTML should
follow these naming conventions to produce the correct editor UX.

---

## 1. Standard Tags — Auto-resolved, not shown in Asset Loader

These variables are filled automatically from subscriber data at send time.
Use them freely in HTML — they do **not** need to be defined in the Asset Loader.

| Variable | Resolved Value |
|---|---|
| `{{first_name}}` | Subscriber's first name |
| `{{last_name}}` | Subscriber's last name |
| `{{email}}` | Subscriber's email address |
| `{{subscriber_id}}` | Subscriber's UUID |
| `{{location_city}}` | Subscriber's city |
| `{{location_country}}` | Subscriber's country |
| `{{discount_code}}` | Pre-set discount code from campaign settings |
| `{{unsubscribe_url}}` | Raw unsubscribe URL |
| `{{unsubscribe_link}}` | Pre-built `<a href="...">Unsubscribe</a>` tag |
| `{{unsubscribe_link_url}}` | Unsubscribe URL (alternate key) |

---

## 2. Image Variable → Image Uploader + File Picker

The Asset Loader shows an **image URL input + upload/browse button + live preview**
when a variable name matches any of these patterns:

| Pattern | Example variables |
|---|---|
| Contains `image` | `{{hero_image}}`, `{{product_image_src}}` |
| Contains `url` | `{{banner_url}}`, `{{promo_url}}` |
| Ends with `_src` | `{{thumbnail_src}}`, `{{video_src}}` |
| Ends with `_bg` | `{{section_bg}}`, `{{hero_bg}}` |
| Ends with `_logo` | `{{brand_logo}}`, `{{partner_logo}}` |
| Ends with `_icon` | `{{feature_icon}}`, `{{badge_icon}}` |
| Ends with `_img` | `{{hero_img}}`, `{{lifestyle_img}}` |

### Exclusions (these look like image vars but are treated differently)

The following are **not** treated as image variables even if they match a pattern above:

- Anything ending in `_fit` → becomes a **Fit dropdown** (see §4)
- Anything ending in `_link_url` or containing `link_url` → becomes a **Link input** (see §3)
- These exact names: `unsubscribe_url`, `privacy_url`, `contact_url`, `about_url`,
  `homepage_url`, `shipping_url`, `main_cta_url`, `crowdfunding_cta_url`

---

## 3. Link Variable → URL Input with Saved-Links Dropdown

The Asset Loader shows a **URL text input** with a bookmark dropdown of saved links when:

- Variable ends with `_link_url`, e.g. `{{hero_link_url}}`, `{{lifestyle_link_url}}`
- Variable contains `link_url`, e.g. `{{video_link_url}}`

### Pairing with an image variable

If a `_link_url` variable shares a prefix with an image variable, it **renders inside
the image card** rather than as a separate row:

```
{{hero_img}}        ← image card
{{hero_link_url}}   ← rendered inside the same image card as "Link destination URL"
```

Pairing is resolved by stripping the image suffix and looking for `{prefix}_link_url`.
Suffixes that are stripped: `_img`, `_src`, `_bg`, `_logo`, `_icon`, `_image`,
`_thumbnail_src`, `_thumbnail`.

Unpaired `_link_url` variables (no matching image var) still render as a standalone
URL input row.

---

## 4. Fit Variable → Object-Fit Dropdown (paired with image)

When a variable ends with `_fit`, the Asset Loader shows an **object-fit select**
with options: `cover`, `contain`, `fill`, `scale-down`.

- Naming convention: `{{<image_variable>_fit}}`
- Example: `{{hero_img_fit}}` pairs with `{{hero_img}}`

If the `_fit` variable shares a prefix with an image variable in the same template,
it renders **inside the image card** (not as a separate row). If there is no matching
image variable, it renders as a standalone dropdown.

---

## 5. Text / Paragraph Variable → Multi-line Textarea

The Asset Loader shows a **resizable textarea** when the variable name:

- Contains `text`, e.g. `{{body_text}}`, `{{intro_text}}`, `{{cta_text}}`
- Contains `paragraph`, e.g. `{{paragraph_one}}`, `{{paragraph_intro}}`

---

## 6. Default → Single-line Text Input

Everything that does not match any of the above rules gets a plain **single-line
text input**.

Examples: `{{cta_label}}`, `{{product_name}}`, `{{promo_title}}`, `{{badge_copy}}`

---

## Full Grouped Card Example

To produce a single image card with an inline link and fit control, declare all
three variables with matching prefixes:

```html
<!-- In your email HTML: -->
<a href="{{hero_link_url}}">
  <img src="{{hero_img}}" style="object-fit: {{hero_img_fit}};" />
</a>
```

The Asset Loader will render **one card** containing:
1. Image URL input + upload button + preview
2. Object-fit dropdown (cover / contain / fill / scale-down)
3. Link destination URL input with saved-links bookmark dropdown

---

## Variable Rendering Priority Order

When the Asset Loader processes a list of variables, it applies checks in this order:

1. Skip if it's a **Standard Tag** (auto-resolved)
2. Skip if it's a `_link_url` or `_fit` var **paired** with an image (rendered inside image card)
3. Render as **Image card** if it matches image patterns
4. Render as **Link input** if it ends with `_link_url` / contains `link_url`
5. Render as **Textarea** if it contains `text` or `paragraph`
6. Render as **Fit dropdown** if it ends with `_fit` (standalone, no paired image)
7. Render as **plain text input** (default)

---

## Quick Reference for AI Agents

| Intent | Recommended variable name |
|---|---|
| Hero image | `{{hero_img}}` |
| Hero image click destination | `{{hero_link_url}}` |
| Hero image object-fit | `{{hero_img_fit}}` |
| Section background | `{{section_bg}}` |
| Product photo | `{{product_img}}` |
| Product photo link | `{{product_link_url}}` |
| Logo | `{{brand_logo}}` |
| Long body copy | `{{body_text}}` |
| Short label / heading | `{{section_title}}` (plain text input) |
| CTA button label | `{{cta_label}}` (plain text input) |
| CTA button URL | `{{cta_link_url}}` (link input) |
| Subscriber first name | `{{first_name}}` (auto — no asset needed) |
| Unsubscribe link | `{{unsubscribe_link}}` (auto — no asset needed) |
