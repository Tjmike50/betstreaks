

## Pass 1 — Structural Navigation Redesign

### Implementation

#### 1. `src/index.css` — Add minimal utility classes
Add after the existing `@layer base` block:
- `.glass-card` — semi-transparent card with backdrop-blur
- `.gradient-primary` — linear gradient using BetStreaks primary blue
- `.gradient-premium` — gold/amber gradient for Playoff Pass CTA

#### 2. `src/components/DesktopSidebar.tsx` — New file
Uses shadcn `Sidebar` with `collapsible="icon"`. Structure:

- **Header**: "🔥 BetStreaks" branding with "NBA Playoffs" subtitle
- **Main nav group** (10 items): Home, Today, AI Builder, Best Bets, Saved Slips, Alerts (with badge), Favorites, Watchlist, Account, Premium
- **Admin group** (conditional): Admin link shown only when `useAdmin().isAdmin`
- **Footer**: Compact Playoff Pass CTA card for non-premium users — "$25 through the Finals" + "Promo codes accepted at checkout"
- Uses `NavLink` for active highlighting, `useAlerts` for badge count, `usePremiumStatus` for CTA visibility
- Hidden on mobile via the Sidebar component's built-in mobile behavior (renders as Sheet)

#### 3. `src/components/MobileHeader.tsx` — New file
- `md:hidden` sticky header
- Left: "🔥 BetStreaks" text
- Right: `SidebarTrigger` hamburger button (opens the Sidebar as a sheet on mobile)
- Clean, minimal — no extra content

#### 4. `src/components/BottomNav.tsx` — Update
- Add `md:hidden` to hide on desktop
- Keep exactly 5 items: Home (`/`), Today (`/today`), AI (`/ai-builder`), Alerts (`/alerts`), Account (`/account`)
- Add `backdrop-blur-lg` and safe-area bottom padding
- Remove the player-page hide logic (unnecessary with new shell)

#### 5. `src/App.tsx` — Restructure
- Move `BrowserRouter` to wrap `SidebarProvider`
- Layout: `SidebarProvider > flex wrapper > DesktopSidebar + main content column`
- `MobileHeader` renders inside content column
- Routes render inside `main`
- `BottomNav` stays fixed, outside the flex wrapper

#### 6. `src/pages/Index.tsx` — Minimal cleanup
- Remove the full `<header>` block (lines 118-146) — branding handled by sidebar/mobile header
- **Keep page context clear**: Add a lightweight inline page title section:
  - "Playoff Streaks" heading (h2, not h1 — the shell provides app branding)
  - "Track active NBA Playoff player & team prop streaks, updated daily." subtitle
  - Keep `AdminRefreshButton` inline
  - Keep the logged-out CTA
- Keep EarlyAccessBanner, DataFreshnessIndicator, filters, content, footer unchanged

### Files changed
1. `src/index.css` — add 3 utility classes
2. `src/components/DesktopSidebar.tsx` — **new**
3. `src/components/MobileHeader.tsx` — **new**
4. `src/components/BottomNav.tsx` — update (md:hidden, backdrop-blur, remove player-page logic)
5. `src/App.tsx` — restructure with SidebarProvider
6. `src/pages/Index.tsx` — replace header with lightweight page title

### Constraints honored
- No backend changes
- No features removed
- Mobile bottom nav: exactly 5 items
- AI Builder stays prominent in nav
- Playoff Pass CTA compact in sidebar footer
- Desktop sidebar expanded by default (collapsible="icon" for optional collapse, but defaultOpen=true)
- Premium listed as a normal nav item

