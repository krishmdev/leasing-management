import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer", "pg-boss", "sharp", "pg", "nodemailer"],
  poweredByHeader: false,
};

export default nextConfig;
