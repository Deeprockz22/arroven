import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM and unpdf ships a worker; both must load from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite", "unpdf"],
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
  poweredByHeader: false,
  // Lets phones and other machines on the local network use the dev server. Has no effect in production.
  allowedDevOrigins: ["192.168.0.26", "192.168.0.74", "*.local"],
};

export default nextConfig;
