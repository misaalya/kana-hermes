import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kana — Hermes interface",
    short_name: "Kana",
    description:
      "A local visual conversation layer for an existing Hermes Agent installation.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#5a4b8f",
    theme_color: "#5a4b8f",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
