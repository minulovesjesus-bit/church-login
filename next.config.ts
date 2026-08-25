import type { NextConfig } from "next";

const fastApiOrigin = process.env.FASTAPI_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.153"],
  async rewrites() {
    if (process.env.NODE_ENV !== "development") {
      return [];
    }

    return [
      {
        source: "/api/:path*",
        destination: `${fastApiOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
