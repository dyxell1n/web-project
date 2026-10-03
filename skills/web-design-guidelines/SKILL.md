---
name: web-design-guidelines
description: Enforces all 5 interactive states (default, hover, active, focus-visible, disabled), guarantees WCAG AA contrast, zero layout shifts (CLS), and semantic HTML. Use when building, auditing, or reviewing UI components, interactive elements, forms, accessibility, and web interface standards.
---

# Web Design Guidelines: Interactive States, Accessibility & Performance

## Overview

A resilient web interface must be accessible, predictable, and performant under all real-world conditions. This skill enforces rigorous standards for **interactive states**, **WCAG AA accessibility**, **zero Cumulative Layout Shift (CLS)**, and **semantic HTML5 structure**.

---

## 1. The 5 Mandatory Interactive States

Every interactive element (`<button>`, `<a>`, `<input>`, tabs, toggles, list items) **MUST explicitly define all 5 states**:

```
[Default] ──▶ [Hover] ──▶ [Active / Pressed] ──▶ [Focus-Visible] ──▶ [Disabled]
```

### State Specifications

| State | Visual Treatment & Behavior | CSS / Tailwind Implementation |
| :--- | :--- | :--- |
| **1. Default** | Clear affordance, legible contrast, proper padding and touch target (`min-h-[40px]` or `min-h-[44px]`). | Baseline classes: `bg-zinc-900 text-white rounded-lg px-4 py-2 text-sm font-medium` |
| **2. Hover** | Subtle visual change indicating responsiveness (lightness shift `±5–8%`, border contrast increase, or `translate-y-[-1px]`). | `hover:bg-zinc-800 transition-colors duration-150` |
| **3. Active** | Tactical feedback on press/click: subtle scale down (`scale-[0.98]`), darker shade, or depressed border. | `active:scale-[0.98] active:bg-zinc-950 transition-transform duration-75` |
| **4. Focus-Visible** | High-contrast keyboard focus indicator. **Never use `outline: none` without a replacement**. Only trigger on keyboard navigation via `:focus-visible`. | `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 dark:focus-visible:ring-white` |
| **5. Disabled** | Distinct de-emphasized appearance (`opacity-50`, `grayscale-[20%]`), `cursor-not-allowed`, and pointer events disabled or handled. | `disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none` |

### Code Contract Example (React + Tailwind)
```tsx
export function Button({ variant = 'primary', disabled, children, ...props }: ButtonProps) {
  return (
    <button
      disabled={disabled}
      className={clsx(
        // Base / Default
        "inline-flex items-center justify-center font-medium rounded-md px-4 py-2.5 text-sm select-none",
        "bg-zinc-900 text-zinc-50 border border-zinc-800",
        // Hover
        "hover:bg-zinc-800 hover:border-zinc-700",
        // Active / Pressed
        "active:scale-[0.98] active:bg-zinc-950",
        // Focus-Visible (Keyboard only)
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900",
        // Disabled
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
        // Motion transitions
        "transition duration-150 ease-out"
      )}
      {...props}
    >
      {children}
    </button>
  );
}
```

---

## 2. Guaranteed WCAG AA Contrast & Accessibility

### Contrast Ratios (ISO-9241 / WCAG 2.1 AA)
- **Normal Text** (< 18pt or < 14pt bold): Minimum contrast ratio of **4.5:1** against its direct background.
- **Large Text** (≥ 18pt or ≥ 14pt bold): Minimum contrast ratio of **3.0:1**.
- **UI Components & Graphical Objects**: Minimum contrast ratio of **3.0:1** for input borders, focus indicators, icons that convey status, and buttons.
- **Color Independence**: Never convey information by color alone. Error fields must pair red color with an inline error message and icon. Success states must include checkmarks or descriptive labels.

### Semantic ARIA Guardrails
- **Icon-Only Controls**: Every icon button MUST have an explicit `aria-label`:
  ```html
  <button aria-label="Close dialog">
    <CloseIcon aria-hidden="true" />
  </button>
  ```
- **Decorative Elements**: All decorative SVGs, illustrations, or background visuals MUST include `aria-hidden="true"`.
- **Dynamic Updates**: Asynchronous toasts, notifications, and live status banners MUST use `aria-live="polite"` (or `role="alert"` for critical system errors).

---

## 3. Zero Cumulative Layout Shift (CLS < 0.1)

Layout stability is paramount. Content must never jump or shift while assets or async data load.

### Layout Rules
1. **Explicit Dimensions on Replaced Elements**:
   - Every `<img>`, `<video>`, `<iframe>`, and SVG image MUST have explicit `width` and `height` attributes or a CSS `aspect-ratio`:
   ```html
   <!-- Aspect ratio prevents jump before download completes -->
   <img src="/hero.jpg" width="1200" height="630" class="aspect-[1200/630] w-full h-auto" alt="Preview" />
   ```
2. **Space Reservation for Async Content**:
   - Pre-allocate space for ads, banners, embeds, and dynamic widgets using skeleton placeholders matching the exact container dimensions:
   ```html
   <div class="h-48 w-full bg-zinc-100 dark:bg-zinc-800 animate-pulse rounded-lg" aria-hidden="true" />
   ```
3. **Font Loading Strategy**:
   - Use `font-display: swap` paired with matching fallback metric overrides (`size-adjust`, `ascent-override`, `descent-override`) to prevent FOIT/FOUT shift.
4. **No Unexpected Injections**:
   - Never inject banners, cookie bars, or floating alert headers into the DOM above existing content after initial render. Use overlays, sticky footers, or reserve layout space.

---

## 4. Semantic HTML5 Architecture

Prefer native HTML elements over custom `<div>` / `<span>` implementations:

| Requirement | Native Semantic Tag | Prohibited Pattern |
| :--- | :--- | :--- |
| **Interactive Action** | `<button type="button">` | `<div onClick={...}>` |
| **Page Navigation** | `<a href="...">` / `<Link href="...">` | `<button onClick={() => router.push(...)}>` |
| **Page Structure** | `<header>`, `<nav>`, `<main>`, `<article>`, `<aside>`, `<footer>` | `<div id="header">`, `<div class="main-content">` |
| **Form Association** | `<label htmlFor="email">Email</label>` | `<span class="label">Email</span>` |
| **Dialogs / Modals** | `<dialog>` or properly aria-managed portal with focus trap | Unmanaged `<div>` overlay without focus trap or escape handler |

---

## 5. Audit & Verification Checklist

When validating any interface or component:
- [ ] Are all 5 interactive states implemented (default, hover, active, focus-visible, disabled)?
- [ ] Is keyboard focus clearly visible using `:focus-visible`?
- [ ] Does all body copy clear 4.5:1 contrast against its background?
- [ ] Do all images/media have explicit dimensions or `aspect-ratio`?
- [ ] Are form labels clickable and properly linked to input IDs?
- [ ] Does the page achieve CLS < 0.1 during full initial load and async transitions?
