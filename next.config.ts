import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  // The AI prompts are read from prompts/*.md at runtime; ship them with every server function.
  outputFileTracingIncludes: { "/**/*": ["./prompts/**/*.md"] },
};

export default nextConfig;
