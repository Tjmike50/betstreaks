import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handleWebhookRequest } from "./handler.ts";

serve((req) => handleWebhookRequest(req));
