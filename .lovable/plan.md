

# Responsible Gambling Page Implementation Plan

## Overview
Add a Responsible Gambling & Disclaimer page to BetStreaks that displays important gambling safety information and helpline resources, with navigation links from the Footer and Account page alongside the existing Terms and Privacy links.

## Implementation Steps

### 1. Create Responsible Gambling Page
**File:** `src/pages/ResponsibleGamblingPage.tsx`

Create a new page following the same structure as `TermsPage.tsx` and `PrivacyPage.tsx`:
- Header with back navigation (ArrowLeft icon) and "Responsible Gambling" title
- "Last updated: January 2025" subtitle
- Card-based content area with all 5 sections
- Special emphasis styling for the "Important Notice" section at the top
- Highlighted helpline section with phone number and link
- Footer component at the bottom

**Content structure:**
```text
Section 1: Important Notice (BetStreaks is NOT a sportsbook disclaimer)
Section 2: Information Only (entertainment purposes statement)
Section 3: No Guarantees (unpredictable outcomes warning)
Section 4: Bet Responsibly (bullet list of responsible gambling tips)
Section 5: Problem Gambling Help (helpline with phone + link)
```

### 2. Add Route for Responsible Gambling Page
**File:** `src/App.tsx`

Register the new `/responsible-gambling` route:
```
<Route path="/responsible-gambling" element={<ResponsibleGamblingPage />} />
```

### 3. Update Footer with Responsible Gambling Link
**File:** `src/components/Footer.tsx`

Add a "Responsible Gambling" link to the existing links row:
- Display all three links (Terms, Privacy, Responsible Gambling) with dot separators
- Maintain consistent styling

### 4. Update Account Page with Responsible Gambling Link
**File:** `src/pages/AccountPage.tsx`

Add a "Responsible Gambling" link in both logged-in and logged-out views:
- Import `AlertTriangle` icon from lucide-react for visual distinction
- Place it alongside Terms and Privacy links
- Display all three links in a row with proper spacing

## UI Design

The Responsible Gambling page will follow the established app patterns:
- Dark theme consistent with Terms/Privacy pages
- Header with back arrow navigation using `Button` ghost variant
- Card-based content layout using `Card` and `CardContent`
- Section headings in bold (no numbering for this page, as the content flows differently)
- Body text in muted foreground color with `whitespace-pre-line` for bullet formatting
- Special styling for the helpline section:
  - Phone number displayed prominently with clickable `tel:` link
  - Website URL as clickable external link
- Proper spacing between sections using `space-y-6`

## Technical Details

- Uses existing UI components: `Button`, `Card`, `CardContent`
- Uses `react-router-dom` for navigation with `useNavigate` and `Link`
- External link for NCPG website opens in new tab with `target="_blank"` and `rel="noopener noreferrer"`
- Phone number uses `tel:` protocol for mobile click-to-call
- Footer displays all three legal links with visual separators
- Account page shows all three links with distinct icons:
  - `FileText` for Terms
  - `Shield` for Privacy
  - `AlertTriangle` for Responsible Gambling

