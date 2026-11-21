import type { NextConfig } from "next";

// Cloud previews are served from their own hostname, so the dev server has to
// be told about it explicitly. Nothing is hardcoded: the host is passed in for
// the single dev process that needs it.
const devOrigin = process.env.ACUYE_DEV_ORIGIN?.trim();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: devOrigin ? [devOrigin] : [],
  poweredByHeader: false,
};

export default nextConfig;
