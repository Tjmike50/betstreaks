import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { browserSupabaseConfig } from "./src/integrations/supabase/config";

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  if (command === "build") browserSupabaseConfig(loadEnv(mode, process.cwd()));
  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
