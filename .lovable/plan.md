

# Terms of Service Implementation Plan

## Overview
Add a Terms of Service page to BetStreaks that displays the legal terms provided, with navigation links from relevant places in the app.

## Implementation Steps

### 1. Create Terms of Service Page
**File:** `src/pages/TermsPage.tsx`

Create a new page that displays the full Terms of Service content:
- Header with back navigation and "Terms of Service" title
- Scrollable content area with all 10 sections formatted nicely
- Each section as a numbered heading with content below
- Effective date placeholder that can be updated later
- Footer component at the bottom

### 2. Add Route for Terms Page
**File:** `src/App.tsx`

Register the new `/terms` route in the router configuration.

### 3. Add Links to Terms of Service
**File:** `src/pages/AccountPage.tsx`

Add a "Terms of Service" link in both the logged-in and logged-out account views, placed near the bottom of the card content.

**File:** `src/components/Footer.tsx`

Add a clickable "Terms of Service" link at the bottom of the footer so it's accessible from any page that uses the Footer component.

## UI Design

The Terms page will follow the existing app patterns:
- Dark theme consistent with the rest of the app
- Header with back arrow navigation
- Card-based content layout
- Section headings in bold with numbering
- Body text in muted foreground color
- Proper spacing between sections for readability

## Technical Details

- Uses existing UI components: `Button`, `Card`, `CardContent`, `ScrollArea`
- Uses `react-router-dom` for navigation with `useNavigate` and `Link`
- Follows the same page structure pattern as `PremiumPage.tsx` and `AccountPage.tsx`
- Footer links use `Link` component for proper SPA navigation

