import { NextResponse } from "next/server";

import { getLatestRelease } from "@/lib/releases";

export const revalidate = 600;

export async function GET() {
  const release = await getLatestRelease();
  return NextResponse.json(release, {
    headers: {
      // The page reads this on mount to pick up a build published since the
      // last render. Ten minutes of edge caching is plenty for a release page.
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400",
    },
  });
}
