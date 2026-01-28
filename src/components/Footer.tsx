import { Link } from "react-router-dom";

export function Footer() {
  return (
    <footer className="px-4 py-6 text-center">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Streaks are calculated from the most recent game backward. Season hit
        rate is based on games played this season.
      </p>
      <p className="text-xs text-muted-foreground leading-relaxed mt-2">
        BetStreaks is a research tool. No betting advice is provided. Past performance does not guarantee future results.
      </p>
      <Link 
        to="/terms" 
        className="inline-block mt-3 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
      >
        Terms of Service
      </Link>
    </footer>
  );
}
