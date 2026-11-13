export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const country = request.headers.get("cf-ipcountry") || "unknown";
    const userAgent = request.headers.get("user-agent") || "unknown";

    console.log(`[Visitor] ${request.method} ${url.pathname} | Country: ${country} | IP: ${ip} | UA: ${userAgent.slice(0, 60)}`);

    return env.ASSETS.fetch(request);
  },
};
