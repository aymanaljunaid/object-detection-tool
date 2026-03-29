import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // Bug 6 fix: Re-enable TypeScript build error checking.
    // ignoreBuildErrors was set to true, which silently shipped broken
    // TypeScript to production without any warnings. Build errors should
    // always be surfaced so they can be fixed before deployment.
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  // Enable cross-origin isolation for SharedArrayBuffer (WASM multi-threading)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
