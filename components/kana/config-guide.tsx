"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tokenizeJson } from "@/lib/presentation/json-highlight";
import { parseMarkdown } from "@/lib/presentation/markdown";
import { LocalPreferencesStore } from "@/lib/preferences/local-preferences-store";
import { useTheme } from "@/lib/state/use-theme";
import {
  CONFIG_GUIDE_GROUPS,
  CONFIG_GUIDE_PATH_BLOCK,
  getConfigGuideCopy,
  headingAnchor,
  readConfigGuide,
  type ConfigGuideCopy,
  type ConfigGuideSection,
} from "@/lib/ui/config-guide";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import { renderMarkdownBlocks, renderMarkdownInline, type MarkdownRenderers } from "./chat-markdown";
import { MaterialSymbol, type MaterialSymbolName } from "./material-symbol";

// Real icons here (Material Symbols), not the app's two-tone drawn glyphs.
const SECTION_ICONS: Record<string, MaterialSymbolName> = {
  quickstart: "bolt",
  voice: "record_voice_over",
  irodori: "memory",
  pollinations: "cloud",
  hermes: "dns",
  deployment: "lan",
  environment: "terminal",
  troubleshooting: "help",
};

const CODE_LABELS: Record<string, string> = {
  json: "config.json",
  sh: "Terminal",
  bash: "Terminal",
  shell: "Terminal",
};

/** Where a section counts as "being read": just below the top edge. */
const SPY_OFFSET = 120;

function CopyButton({ text, label, doneLabel, target }: {
  text: string;
  label: string;
  doneLabel: string;
  /** Selected instead when the clipboard is unavailable (plain-http LAN). */
  target: React.RefObject<HTMLElement | null>;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      if (target.current) window.getSelection()?.selectAllChildren(target.current);
    }
  }, [target, text]);

  return (
    <button
      type="button"
      className="kana-focus inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold text-muted transition-colors hover:bg-surface hover:text-ink"
      onClick={() => void copy()}
      aria-live="polite"
    >
      <MaterialSymbol name={copied ? "check" : "content_copy"} className="text-[15px]" />
      {copied ? doneLabel : label}
    </button>
  );
}

function JsonCode({ code }: { code: string }) {
  return tokenizeJson(code).map((token, index) =>
    token.kind === "plain" ? token.text : (
      <span key={index} className={`kana-json-${token.kind}`}>
        {token.text}
      </span>
    ),
  );
}

function CodeBlock({ language, code, copy }: { language: string; code: string; copy: ConfigGuideCopy }) {
  const codeRef = useRef<HTMLElement>(null);
  const label = CODE_LABELS[language] ?? language;
  return (
    <figure className="kana-code-surface overflow-hidden bg-surface-strong">
      <figcaption className="flex min-h-11 items-center justify-between gap-3 py-1.5 pl-4 pr-1.5">
        <span className="text-[12px] font-bold text-muted">{label}</span>
        <CopyButton text={code} label={copy.copy} doneLabel={copy.copied} target={codeRef} />
      </figcaption>
      <pre className="overflow-x-auto px-4 pb-4 pt-0.5 font-mono text-[13px] leading-relaxed text-ink">
        <code ref={codeRef}>{language === "json" ? <JsonCode code={code} /> : code}</code>
      </pre>
    </figure>
  );
}

type ConfigFileState = {
  path: string;
  deploymentMode: "local" | "deployment";
  configError: string | null;
};

/** The guide's `kana-config-path` block: this installation's own file. */
function ConfigFile({ fallback, copy }: { fallback: string; copy: ConfigGuideCopy }) {
  const [state, setState] = useState<ConfigFileState | null>(null);
  const pathRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true;
    void fetch("/api/kana/config", { credentials: "same-origin", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: Partial<ConfigFileState> | null) => {
        if (!active || !value?.path) return;
        setState({
          path: value.path,
          deploymentMode: value.deploymentMode === "deployment" ? "deployment" : "local",
          configError: value.configError ?? null,
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const path = state?.path ?? fallback;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2" aria-live="polite">
      <div className="kana-code-surface flex items-center gap-2 bg-surface-strong py-1.5 pl-4 pr-1.5">
        <code
          ref={pathRef}
          className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[13px] text-ink"
          data-testid="config-guide-path"
        >
          {path}
        </code>
        <CopyButton text={path} label={copy.copy} doneLabel={copy.copied} target={pathRef} />
      </div>
      {state ? (
        <p className="px-1 text-[12.5px] text-muted">
          {copy.mode}: {state.deploymentMode === "deployment" ? copy.modeDeployment : copy.modeLocal}
        </p>
      ) : null}
      {state?.configError ? (
        <p className="text-[13px] leading-relaxed text-danger" role="alert">
          {copy.configError} {state.configError}
        </p>
      ) : null}
    </div>
  );
}

export function ConfigGuide({
  sources,
  fontClassName = "",
}: {
  sources: Record<UiLocale, string>;
  /** next/font variable class that defines --font-doc-sans for the content. */
  fontClassName?: string;
}) {
  const { theme, toggleTheme } = useTheme();
  const [locale, setLocale] = useState<UiLocale>("id");
  const [active, setActive] = useState<string>("quickstart");
  const scrollerRef = useRef<HTMLElement>(null);
  const guide = useMemo(() => readConfigGuide(parseMarkdown(sources[locale])), [sources, locale]);
  const copy = getConfigGuideCopy(locale);
  const workspace = getCopy(locale).workspace;

  const renderers = useMemo<MarkdownRenderers>(
    () => ({
      heading: (node, key) => {
        const { id, children } = headingAnchor(node.children);
        const Heading = node.level <= 3 ? "h3" : "h4";
        return (
          <Heading key={key} id={id ?? undefined}>
            {renderMarkdownInline(children)}
          </Heading>
        );
      },
      code: (node, key) =>
        node.language === CONFIG_GUIDE_PATH_BLOCK ? (
          <ConfigFile key={key} fallback={node.text.trim()} copy={copy} />
        ) : (
          <CodeBlock key={key} language={node.language} code={node.text} copy={copy} />
        ),
    }),
    [copy],
  );

  useEffect(() => {
    // Browser-only preference; read after hydration to avoid a mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocale(new LocalPreferencesStore().load().uiLocale);
  }, []);

  useEffect(() => {
    if (guide.title) document.title = `${guide.title} · Kana`;
  }, [guide.title]);

  // The content scrolls inside its own pane (the app locks html/body), so a
  // deep link such as /docs#pollinations is resolved here as well.
  useEffect(() => {
    const target = decodeURIComponent(window.location.hash.slice(1));
    if (target) document.getElementById(target)?.scrollIntoView({ block: "start" });
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const ids = guide.sections.map((section) => section.id);
      if (!ids.length) return;
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      if (atEnd && scroller.scrollTop > 0) {
        setActive(ids[ids.length - 1]);
        return;
      }
      const top = scroller.getBoundingClientRect().top;
      let current = ids[0];
      for (const id of ids) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top - top <= SPY_OFFSET) current = id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [guide.sections]);

  // Sidebar groups follow CONFIG_GUIDE_GROUPS; a section outside them still
  // gets an entry, after the groups.
  const navGroups = useMemo(() => {
    const byId = new Map(guide.sections.map((section) => [section.id, section]));
    const grouped = new Set<string>();
    const groups: { id: string; label: string | null; sections: ConfigGuideSection[] }[] = CONFIG_GUIDE_GROUPS.map(
      (group) => {
        const sections = group.sections.flatMap((id) => byId.get(id) ?? []);
        sections.forEach((section) => grouped.add(section.id));
        return { id: group.id, label: copy.groups[group.id], sections };
      },
    );
    const rest = guide.sections.filter((section) => !grouped.has(section.id));
    if (rest.length) groups.push({ id: "other", label: null, sections: rest });
    return groups.filter((group) => group.sections.length);
  }, [copy, guide.sections]);

  const nextTheme = theme === "dark" ? "light" : "dark";
  const roundButton =
    "kana-focus grid size-9 shrink-0 place-items-center rounded-full bg-surface-strong text-muted transition-colors hover:text-ink";
  const themeButton = (
    <button
      type="button"
      className={roundButton}
      onClick={toggleTheme}
      aria-label={workspace.switchTheme(nextTheme)}
    >
      <MaterialSymbol name={theme === "dark" ? "light_mode" : "dark_mode"} className="text-[19px]" />
    </button>
  );

  return (
    <div className={`${fontClassName} grid h-dvh grid-cols-[260px_minmax(0,1fr)] bg-raised font-sans max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(0,1fr)]`}>
      {/* The same sidebar as Settings: plain group labels, pill items, and a dotted edge. */}
      <aside className="flex min-h-0 flex-col border-r-[3px] border-dotted border-line-strong bg-surface-strong/35 px-3.5 pb-4 pt-6 max-md:border-b-[3px] max-md:border-r-0 max-md:bg-raised max-md:px-0 max-md:pb-0 max-md:pt-2">
        <div className="mb-4 flex items-center justify-between gap-3 px-3 max-md:mb-1 max-md:px-4">
          <p className="text-[22px] font-extrabold text-ink">{copy.docs}</p>
          <div className="flex items-center gap-1.5 md:hidden">
            {themeButton}
            <Link href="/" className={roundButton} aria-label={copy.back}>
              <MaterialSymbol name="home" className="text-[19px]" />
            </Link>
          </div>
        </div>
        <nav
          className="kana-settings-nav flex min-h-0 flex-col gap-1 overflow-y-auto max-md:flex-row max-md:overflow-x-auto max-md:overflow-y-visible max-md:px-3 max-md:pb-2"
          aria-label={copy.contents}
        >
          {navGroups.map((group, groupIndex) => (
            <div key={group.id} className="grid gap-1 max-md:contents">
              {group.label ? (
                <p className={`mb-0.5 px-3.5 text-[11.5px] font-extrabold text-muted max-md:hidden ${groupIndex ? "mt-4" : ""}`}>
                  {group.label}
                </p>
              ) : null}
              {group.sections.map((section) => {
                const current = active === section.id;
                return (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    aria-current={current ? "location" : undefined}
                    className={`kana-settings-nav-item kana-focus flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] max-md:shrink-0 max-md:whitespace-nowrap max-md:py-2 ${current ? "is-active" : ""}`}
                  >
                    <MaterialSymbol name={SECTION_ICONS[section.id] ?? "menu_book"} className="shrink-0 text-[19px]" />
                    {section.title}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-2 px-3 pt-4 max-md:hidden">
          <Link href="/" className="kana-focus kana-pill kana-pill-soft min-h-9 flex-1 px-4 text-[12px]">
            <MaterialSymbol name="home" className="text-[17px]" />
            {copy.back}
          </Link>
          {themeButton}
        </div>
      </aside>

      <main
        ref={scrollerRef}
        className="min-h-0 overflow-y-auto scroll-smooth px-14 pb-20 pt-10 max-lg:px-10 max-md:px-4 max-md:pb-12 max-md:pt-6"
      >
        {/* A plain Markdown document: one column, read top to bottom. */}
        <article className="kana-doc" lang={locale}>
          <h1>{guide.title}</h1>
          {renderMarkdownBlocks(guide.intro, renderers)}
          {guide.sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-title`}
              className="kana-doc-section scroll-mt-8 max-md:scroll-mt-4"
            >
              <h2 id={`${section.id}-title`}>{renderMarkdownInline(section.heading)}</h2>
              {renderMarkdownBlocks(section.blocks, renderers)}
            </section>
          ))}
        </article>
      </main>
    </div>
  );
}
