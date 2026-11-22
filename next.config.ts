import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server build for the Docker image (Coolify on our VPS).
  output: "standalone",
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  // The AI prompts are read from prompts/*.md at runtime; ship them with every server function.
  outputFileTracingIncludes: { "/**/*": ["./prompts/**/*.md", "./rrjedhat/**/*.md"] },
};

export default nextConfig;
