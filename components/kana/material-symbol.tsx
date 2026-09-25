import localFont from "next/font/local";

// Real icons for the /docs guide: Material Symbols Rounded, subset to the
// names below (see app/fonts/README.md to add one). A glyph is drawn from its
// ligature name; `display: block` keeps the name itself from flashing.
const materialSymbols = localFont({
  src: "../../app/fonts/material-symbols-rounded.woff2",
  weight: "500",
  display: "block",
});

export type MaterialSymbolName =
  | "bolt"
  | "check"
  | "cloud"
  | "content_copy"
  | "dark_mode"
  | "dns"
  | "help"
  | "home"
  | "lan"
  | "light_mode"
  | "memory"
  | "menu_book"
  | "record_voice_over"
  | "terminal";

export function MaterialSymbol({ name, className }: { name: MaterialSymbolName; className?: string }) {
  return (
    <span aria-hidden="true" className={`kana-symbol ${materialSymbols.className} ${className ?? ""}`}>
      {name}
    </span>
  );
}
