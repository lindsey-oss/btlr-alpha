// Finds top 3 nearby contractors for a given trade using Google Places API.
// 1. Text Search — finds relevant businesses near the address.
// 2. Place Details — fetches phone number for each result (Text Search doesn't include it).

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

export async function POST(req) {
  try {
    const { trade, address } = await req.json();
    if (!trade || !address) return Response.json({ error: "trade and address required" }, { status: 400 });
    if (!MAPS_KEY)           return Response.json({ error: "Maps API key not configured" }, { status: 500 });

    // ── Step 1: Text Search ──────────────────────────────────────────────────
    const searchQuery = `${trade} contractor near ${address}`;
    const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(searchQuery)}&key=${MAPS_KEY}`;
    const searchRes  = await fetch(searchUrl);
    const searchData = await searchRes.json();

    const places = (searchData.results ?? []).slice(0, 3);
    if (!places.length) return Response.json({ contractors: [] });

    // ── Step 2: Place Details for phone numbers ──────────────────────────────
    const contractors = await Promise.all(places.map(async (place) => {
      try {
        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_phone_number,formatted_address,rating,user_ratings_total,website&key=${MAPS_KEY}`;
        const detailRes  = await fetch(detailUrl);
        const detailData = await detailRes.json();
        const d = detailData.result ?? {};
        return {
          name:         d.name             ?? place.name,
          phone:        d.formatted_phone_number ?? null,
          address:      d.formatted_address      ?? place.formatted_address ?? null,
          rating:       d.rating                 ?? place.rating ?? null,
          reviewCount:  d.user_ratings_total      ?? place.user_ratings_total ?? null,
          website:      d.website                ?? null,
          placeId:      place.place_id,
          mapsUrl:      `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
        };
      } catch {
        // If detail call fails, return basic info without phone
        return {
          name:        place.name,
          phone:       null,
          address:     place.formatted_address ?? null,
          rating:      place.rating ?? null,
          reviewCount: place.user_ratings_total ?? null,
          website:     null,
          placeId:     place.place_id,
          mapsUrl:     `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
        };
      }
    }));

    return Response.json({ contractors });
  } catch (err) {
    console.error("[find-contractors] error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
