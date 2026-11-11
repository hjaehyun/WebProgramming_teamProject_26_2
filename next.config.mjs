const nextConfig = {
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
  logging: { incomingRequests: { ignore: [/\/auth\/(confirm|callback)(?:[/?]|$)/] } },
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
    ] }];
  },
};

export default nextConfig;
