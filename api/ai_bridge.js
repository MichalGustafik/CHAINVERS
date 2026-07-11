/*
===============================================================================
CHAINVERS AI BRIDGE
===============================================================================

Tento súbor slúži ako jednoduchá schránka medzi Codexom / AI a InfinityFree PHP.

NEPOTREBUJE:
- FTP
- Vercel
- ENV
- token
- API kľúče

Súbory reálne číta a zapisuje PHP súbor:

    ai_apply.php

-------------------------------------------------------------------------------
AKO ČÍTANIE FUNGUJE
-------------------------------------------------------------------------------

1. Codex vloží názov súboru do bloku:

   CHAINVERS_READ_REQUEST_START
   CHAINVERS_READ_REQUEST_END

2. Otvoríš v prehliadači:

   https://chainvers.free.nf/ai_apply.php

3. PHP načíta požadovaný súbor z /htdocs.

4. PHP vloží celý obsah súboru do bloku:

   CHAINVERS_READ_RESULT_START
   CHAINVERS_READ_RESULT_END

5. Codex si potom z tohto JS súboru prečíta celý kód.

-------------------------------------------------------------------------------
AKO ZÁPIS FUNGUJE
-------------------------------------------------------------------------------

1. Codex vloží názov súboru + celý nový kód do bloku:

   CHAINVERS_WRITE_REQUEST_START
   CHAINVERS_WRITE_REQUEST_END

2. Otvoríš:

   https://chainvers.free.nf/ai_apply.php

3. PHP:
   - spraví zálohu pôvodného súboru do _ai_backups
   - prepíše cieľový súbor
   - vyčistí WRITE_REQUEST blok

-------------------------------------------------------------------------------
DÔLEŽITÉ
-------------------------------------------------------------------------------

Toto je jednoduchý most pre úpravy kódu.
Po dokončení úprav odporúčam ai_apply.php zmazať alebo premenovať.

===============================================================================
*/


/*
===============================================================================
READ REQUEST

Sem Codex vloží súbor, ktorý chce načítať.

Príklad:

{
  "file": "gallery.php"
}

===============================================================================
*/

/* CHAINVERS_READ_REQUEST_START
{
  "file": ""
}
CHAINVERS_READ_REQUEST_END */


/*
===============================================================================
READ RESULT

Sem PHP vloží načítaný kód zo súboru.

Codex si odtiaľ vezme celý obsah súboru.

===============================================================================
*/

/* CHAINVERS_READ_RESULT_START
{
  "file": "",
  "content": "",
  "loaded_at": ""
}
CHAINVERS_READ_RESULT_END */


/*
===============================================================================
WRITE REQUEST

Sem Codex vloží celý nový kód, ktorý sa má zapísať do súboru.

Príklad:

{
  "file": "gallery.php",
  "content": "<?php\nsession_start();\n\necho 'Nový kód';\n?>"
}

===============================================================================
*/

/* CHAINVERS_WRITE_REQUEST_START
{
  "file": "",
  "content": ""
}
CHAINVERS_WRITE_REQUEST_END */


/*
===============================================================================
LAST ACTION

Sem PHP zapíše poslednú vykonanú akciu.

===============================================================================
*/

/* CHAINVERS_LAST_ACTION_START
{
  "ok": true,
  "message": "Bridge pripravený.",
  "actions": []
}
CHAINVERS_LAST_ACTION_END */