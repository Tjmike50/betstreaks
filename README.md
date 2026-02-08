# BetStreaks

NBA player prop streak tracker for sports bettors.

## Paid MVP Launch Checklist

### ✅ Core Fixes Completed
- [x] **Centralized auth state** - AuthProvider ensures consistent user state across all pages
- [x] **Today page reliability** - Filters out placeholder games, shows friendly empty states
- [x] **Data freshness** - 3-hour stale threshold, warning banner disables Best Bet badges
- [x] **Best Bet tooltip** - Shows exact criteria: "Streak ≥3, Season ≥55% or L10 ≥60%, last game within 2 days"
- [x] **Season label** - Displays "2024–25" consistently across the app

### ✅ Premium Conversion
- [x] Premium status indicator on Account page (Premium Active / Free)
- [x] Stripe checkout flow wired via edge functions
- [x] Consistent upgrade CTAs across premium-gated features

### ✅ Watchlist/Favorites UX
- [x] Star toggle clearly shows Added/Remove state
- [x] Supabase sync for logged-in users
- [x] localStorage fallback for guests (max 5)
- [x] "Logged in as {email}" displayed on gated pages
- [x] Loading states during auth initialization

### Known Limitations
- **Alerts page**: Gated as "Coming Soon" for non-premium users
- **Push notifications**: Not yet implemented (placeholder toggle)
- **Pagination**: Large streak lists may lag on older devices (optimization pending)
- **Combo stats**: Premium-only (PTS+AST, PTS+REB, etc.)

### Pre-Launch Verification
1. **Login persists across refresh** ✓
2. **Favorites works while logged in** ✓
3. **Today page always renders meaningful content** ✓
4. **Premium status flips after Stripe checkout** (requires live Stripe test)

---

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
