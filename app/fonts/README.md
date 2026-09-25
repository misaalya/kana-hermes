# Icon font

`material-symbols-rounded.woff2` is a subset of Google's
[Material Symbols Rounded](https://fonts.google.com/icons) (Filled, weight 500,
grade 0, optical size 24), licensed under the Apache License 2.0
(`LICENSE-material-symbols.txt`). It holds only the icons Kana uses, so it is a
few kilobytes and works offline. `components/kana/material-symbol.tsx` loads it
through `next/font/local`.

To add an icon, add its name to `MaterialSymbolName` and regenerate the file
with every name, sorted alphabetically:

```bash
names=bolt,check,cloud,content_copy,dark_mode,dns,help,home,lan,light_mode,memory,menu_book,record_voice_over,terminal
# A full Chrome user agent: a shorter one may be served TrueType, not woff2.
ua="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
css=$(curl -sS -A "$ua" \
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,500,1,0&icon_names=$names&display=block")
curl -sS "$(grep -o 'https://fonts.gstatic.com[^)]*' <<<"$css")" -o app/fonts/material-symbols-rounded.woff2
```
