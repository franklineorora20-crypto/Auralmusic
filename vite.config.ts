import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

function disableHmrWebSocketPlugin(): Plugin {
  let hmrDisabled = false;
  return {
    name: "aural-disable-hmr-websocket",
    apply: "serve",
    configResolved(config) {
      hmrDisabled = config.server.hmr === false || config.server.ws === false;
    },
    transform(code, id) {
      if (!hmrDisabled) return null;
      const cleanId = id.split("?")[0];
      if (/[/\\]vite[/\\]dist[/\\]client[/\\]client\.mjs$/.test(cleanId) && code.includes("transport.connect(")) {
        return {
          code: code.replace(
            "transport.connect(createHMRHandler(handleMessage));",
            "/* HMR WebSocket disabled */",
          ),
          map: null,
        };
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [
    disableHmrWebSocketPlugin(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "icon.svg",
        "apple-touch-icon.png",
        "pwa-192x192.png",
        "pwa-512x512.png",
        "pwa-maskable-512x512.png",
      ],
      manifest: {
        id: "/",
        name: "Aural",
        short_name: "Aural",
        description: "Aural - Music for every moment",
        theme_color: "#100f0d",
        background_color: "#100f0d",
        display: "standalone",
        display_override: ["standalone", "minimal-ui"],
        categories: ["music", "audio", "entertainment"],
        prefer_related_applications: false,
        start_url: "/",
        scope: "/",
        orientation: "any",
        ...({ launch_handler: { client_mode: "focus-existing" } } as Record<string, unknown>),
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "gstatic-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
    hmr: false,
    ws: false,
  },
});
