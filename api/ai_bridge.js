/*
===============================================================================
CHAINVERS GITHUB ↔ INFINITYFREE AI BRIDGE
===============================================================================

Tento súbor je schránka pre Codex / AI.

UMIE:
- požiadať InfinityFree PHP o načítanie súboru
- požiadať InfinityFree PHP o prepísanie súboru

AKO TO FUNGUJE:

1. Codex upraví tento súbor na GitHube.
2. Do CHAINVERS_REQUEST vloží request_id, action, file a prípadne content.
3. Na InfinityFree sa otvorí:

   https://chainvers.free.nf/ai_apply.php

4. PHP načíta tento JS z GitHub RAW URL.
5. PHP vykoná akciu.
6. Výsledok uloží do:

   https://chainvers.free.nf/ai_result.json

7. Codex si načíta ai_result.json a vidí výsledok.

DÔLEŽITÉ:
- request_id musí byť vždy nový.
- Ak request_id ostane rovnaký, PHP ho druhýkrát nevykoná.
- PHP bez GitHub tokenu nevie tento JS súbor automaticky vyčistiť.
===============================================================================
*/


/*
===============================================================================
CHAINVERS_REQUEST

Príklad READ:

{
  "request_id": "read_gallery_001",
  "action": "read",
  "file": "gallery.php"
}

Príklad WRITE:

{
  "request_id": "write_gallery_001",
  "action": "write",
  "file": "gallery.php",
  "content": "<?php\nsession_start();\n\necho 'Nový kód';\n?>"
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