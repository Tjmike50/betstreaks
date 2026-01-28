import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import PlayerPage from "./pages/PlayerPage";
import StreakDetailPage from "./pages/StreakDetailPage";
import WatchlistPage from "./pages/WatchlistPage";
import BestBetsPage from "./pages/BestBetsPage";
import AlertsPage from "./pages/AlertsPage";
import AccountPage from "./pages/AccountPage";
import PremiumPage from "./pages/PremiumPage";
import AuthPage from "./pages/AuthPage";
import TermsPage from "./pages/TermsPage";
import NotFound from "./pages/NotFound";
import { BottomNav } from "./components/BottomNav";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/best-bets" element={<BestBetsPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/streak" element={<StreakDetailPage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/premium" element={<PremiumPage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/player/:playerId" element={<PlayerPage />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        <BottomNav />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
