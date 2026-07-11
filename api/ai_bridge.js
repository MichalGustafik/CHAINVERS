/*
===============================================================================
CHAINVERS AI BRIDGE
===============================================================================

Tento súbor je schránka medzi Codexom / AI a InfinityFree.

UMIE:
- požiadať InfinityFree PHP o načítanie súboru
- požiadať InfinityFree PHP o prepísanie súboru

AKO TO FUNGUJE:

1. Codex upraví tento súbor na GitHube.
2. Do CHAINVERS_REQUEST vloží request_id, action, file a prípadne content.
3. Otvoríš na InfinityFree:

   https://chainvers.free.nf/ai_apply.php

4. PHP načíta tento JS súbor z GitHub RAW URL.
5. PHP vykoná požiadavku:
   - read = načíta kód zo súboru
   - write = prepíše súbor novým kódom
   - tree = načíta strom /htdocs

6. Výsledok uloží do:

   https://chainvers.free.nf/ai_result.json

DÔLEŽITÉ:
- request_id musí byť vždy nový.
- Ak request_id ostane rovnaký, PHP ho druhýkrát nevykoná.
- Bez GitHub tokenu PHP nevie tento JS automaticky vyčistiť.
===============================================================================
*/


/*
===============================================================================
PRÍKLADY REQUESTOV
===============================================================================

READ:

{
  "request_id": "read_gallery_001",
  "action": "read",
  "file": "gallery.php",
  "content": ""
}

WRITE:

{
  "request_id": "write_gallery_001",
  "action": "write",
  "file": "gallery.php",
  "content": "<?php\nsession_start();\n\necho 'Nový kód';\n?>"
}

TREE:

{
  "request_id": "tree_001",
  "action": "tree",
  "file": ".",
  "content": ""
}

===============================================================================
*/


/* CHAINVERS_REQUEST_START
{
  "request_id": "",
  "action": "",
  "file": "",
  "content": ""
}
CHAINVERS_REQUEST_END */