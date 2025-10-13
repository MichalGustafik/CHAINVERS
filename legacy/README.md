# Legacy API Route Snapshots

Tento priečinok obsahuje pôvodné implementácie jednotlivých Vercel `pages/api/*` súborov,
ktoré boli nahradené univerzálnym routerom [`/api/chainvers.js`](../api/chainvers.js).
Kód je uložený iba ako referenčná archívna verzia, aby sa zachovala história endpointov,
ktoré sa predtým nasadzovali samostatne. Súbory v priečinku `legacy/api` sa do buildu
neťahajú, takže počet serverless funkcií zostáva v limite Hobby plánu, no zároveň
má tím k dispozícii pôvodnú logiku na prípadné porovnanie alebo migrácie.
