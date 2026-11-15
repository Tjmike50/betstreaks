import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { nbaWorkflowEnabled, nbaWorkflowPath, type ImportedLeg } from "./client";

export function NbaWorkflowLink({ legs, tab = "slips", label }: {
  legs?: ImportedLeg[]; tab?: "slips" | "watchlist"; label: string;
}) {
  if (!nbaWorkflowEnabled) return null;
  return (
    <Button asChild variant="outline" size="sm">
      <Link to={`${nbaWorkflowPath}?tab=${tab}`} state={legs?.length ? { nbaImport: legs } : undefined}>
        {label}
      </Link>
    </Button>
  );
}
