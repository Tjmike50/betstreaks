import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handlePortalRequest } from "./handler.ts";

serve((req) => handlePortalRequest(req));
