import type { NextConfig } from "next";
import dns from 'node:dns'
// Принудительно используем IPv4 для предотвращения ошибок ECONNRESET
dns.setDefaultResultOrder('ipv4first')

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
