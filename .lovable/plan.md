
# Privacy Policy Implementation Plan

## Overview
Add a Privacy Policy page to BetStreaks that displays the legal privacy information provided, with navigation links from the Footer and Account page alongside the existing Terms of Service link.

## Implementation Steps

### 1. Create Privacy Policy Page
**File:** `src/pages/PrivacyPage.tsx`

Create a new page following the same structure as `TermsPage.tsx`:
- Header with back navigation (ArrowLeft icon) and "Privacy Policy" title
- "Last updated: January 2025" subtitle
- Card-based content area with all 7 sections
- Each section displayed with numbered headings
- Special formatting for bullet lists in sections 1 and 2
- Footer component at the bottom

**Content structure:**
```text
Section 1: Information We Collect (with "We may collect" and "We do NOT collect" bullet lists)
Section 2: How We Use Information (with bullet list)
Section 3: Data Storage
Section 4: Data Sharing
Section 5: Local Storage
Section 6: Your Rights
Section 7: Policy Changes
```

### 2. Add Route for Privacy Page
**File:** `src/App.tsx`

Register the new `/privacy` route alongside the existing routes:
```
<Route path="/privacy" element={<PrivacyPage />} />
```

### 3. Update Footer with Privacy Link
**File:** `src/components/Footer.tsx`

Add a "Privacy Policy" link next to the existing "Terms of Service" link:
- Display both links side by side with a separator (bullet or pipe)
- Maintain consistent styling with the Terms link

### 4. Update Account Page with Privacy Link
**File:** `src/pages/AccountPage.tsx`

Add a "Privacy Policy" link in both logged-in and logged-out views:
- Import `Shield` icon from lucide-react for visual distinction
- Place it next to the existing Terms of Service link
- Display both links in a row with proper spacing

## UI Design

The Privacy page will follow the established app patterns:
- Dark theme consistent with Terms page and rest of app
- Header with back arrow navigation using `Button` ghost variant
- Card-based content layout using `Card` and `CardContent`
- Section headings in bold with numbering (e.g., "1. Information We Collect")
- Body text in muted foreground color with `whitespace-pre-line` for bullet formatting
- Proper spacing between sections using `space-y-6`

## Technical Details

- Uses existing UI components: `Button`, `Card`, `CardContent`
- Uses `react-router-dom` for navigation with `useNavigate` and `Link`
- Follows the exact same page structure pattern as `TermsPage.tsx`
- Footer displays both legal links with a visual separator
- Account page shows both links with distinct icons (FileText for Terms, Shield for Privacy)
