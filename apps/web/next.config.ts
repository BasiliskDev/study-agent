import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@study/schema", "@study/canvas"],
  // Native / worker-based packages stay in node_modules instead of being bundled
  serverExternalPackages: ["@libsql/client", "unpdf"],
};
export default config;
