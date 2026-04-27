import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { SportProvider } from "@/contexts/SportContext";
import { SidebarProvider } from "@/components/ui/sidebar";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { MobileHeader } from "@/components/MobileHeader";
import { BottomNav } from "@/components/BottomNav";
import DashboardPage from "./pages/DashboardPage";
import StreaksPage from "./pages/StreaksPage";
import TodayPage from "./pages/TodayPage";
import PlayerPage from "./pages/PlayerPage";
import StreakDetailPage from "./pages/StreakDetailPage";
import WatchlistPage from "./pages/WatchlistPage";
import FavoritesPage from "./pages/FavoritesPage";
import BestBetsPage from "./pages/BestBetsPage";
import AlertsPage from "./pages/AlertsPage";
import AccountPage from "./pages/AccountPage";
import PremiumPage from "./pages/PremiumPage";
import AuthPage from "./pages/AuthPage";
import TermsPage from "./pages/TermsPage";
import PrivacyPage from "./pages/PrivacyPage";
import ResponsibleGamblingPage from "./pages/ResponsibleGamblingPage";
import FeedbackPage from "./pages/FeedbackPage";
import AIBetBuilderPage from "./pages/AIBetBuilderPage";
import BetAnalyzerPage from "./pages/BetAnalyzerPage";
import SavedSlipsPage from "./pages/SavedSlipsPage";
import AdminEvalPage from "./pages/AdminEvalPage";
import CheatsheetsHubPage from "./pages/CheatsheetsHubPage";
import ResearchHubPage from "./pages/ResearchHubPage";
import ResearchGamesPage from "./pages/research/ResearchGamesPage";
import ResearchPlayersPage from "./pages/research/ResearchPlayersPage";
import ValueCheatsheetPage from "./pages/cheatsheets/ValueCheatsheetPage";
import StreakCheatsheetPage from "./pages/cheatsheets/StreakCheatsheetPage";
import MatchupCheatsheetPage from "./pages/cheatsheets/MatchupCheatsheetPage";
import BestBetsCheatsheetPage from "./pages/cheatsheets/BestBetsCheatsheetPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <SportProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <SidebarProvider defaultOpen={true}>
            <div className="min-h-screen flex w-full">
              <DesktopSidebar />
              <div className="flex-1 flex flex-col min-h-screen min-w-0">
                <MobileHeader />
                <main className="flex-1">
                  <Routes>
                    <Route path="/" element={<DashboardPage />} />
                    <Route path="/streaks" element={<StreaksPage />} />
                    <Route path="/today" element={<TodayPage />} />
                    <Route path="/best-bets" element={<BestBetsPage />} />
                    <Route path="/cheatsheets" element={<CheatsheetsHubPage />} />
                    <Route path="/cheatsheets/value" element={<ValueCheatsheetPage />} />
                    <Route path="/cheatsheets/streaks" element={<StreakCheatsheetPage />} />
                    <Route path="/cheatsheets/matchups" element={<MatchupCheatsheetPage />} />
                    <Route path="/cheatsheets/best-bets" element={<BestBetsCheatsheetPage />} />
                    <Route path="/alerts" element={<AlertsPage />} />
                    <Route path="/streak" element={<StreakDetailPage />} />
                    <Route path="/watchlist" element={<WatchlistPage />} />
                    <Route path="/favorites" element={<FavoritesPage />} />
                    <Route path="/account" element={<AccountPage />} />
                    <Route path="/premium" element={<PremiumPage />} />
                    <Route path="/auth" element={<AuthPage />} />
                    <Route path="/terms" element={<TermsPage />} />
                    <Route path="/privacy" element={<PrivacyPage />} />
                    <Route path="/responsible-gambling" element={<ResponsibleGamblingPage />} />
                    <Route path="/feedback" element={<FeedbackPage />} />
                    <Route path="/ai-builder" element={<AIBetBuilderPage />} />
                    <Route path="/analyzer" element={<BetAnalyzerPage />} />
                    <Route path="/saved-slips" element={<SavedSlipsPage />} />
                    <Route path="/research" element={<ResearchHubPage />} />
                    <Route path="/research/games" element={<ResearchGamesPage />} />
                    <Route path="/research/players" element={<ResearchPlayersPage />} />
                    <Route path="/research/player/:playerId" element={<PlayerPage />} />
                    <Route path="/player/:playerId" element={<PlayerPage />} />
                    <Route path="/admin/eval" element={<AdminEvalPage />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </main>
              </div>
            </div>
            <BottomNav />
          </SidebarProvider>
          </BrowserRouter>
        </TooltipProvider>
      </SportProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
