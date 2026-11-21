import type { MetadataRoute } from "next";

/**
 * One page, one entry. `SITE_URL` carries the public origin at build time, so
 * nothing has to be hardcoded when this moves to its real domain.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.SITE_URL ?? "http://localhost:3001").replace(/\/+$/, "");
  return [
    {
      url: `${base}/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
