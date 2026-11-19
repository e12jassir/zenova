import { AnimatePresence, motion } from "motion/react";
import { Check, Languages, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { defaultProviderManager } from "../../core/providers/provider.manager";
import { cx } from "../../lib/format";
import { episodeKey, type Episode, type EpisodePointer, type MediaItem } from "../../lib/types";
import { SmartImage } from "../SmartImage";
import type { Panel } from "./PlayerControls";

export interface PlayerDrawersProps {
  panel: Panel;
  setPanel: Dispatch<SetStateAction<Panel>>;
  item: MediaItem;
  episodes: Episode[];
  episode?: EpisodePointer;
  watchedEpisodes: Record<string, true>;
  providerId: string;
  compatMode: boolean;
  onToggleCompatMode: () => void;
  onGoToEpisode: (ep: Episode | EpisodePointer) => void;
  onSwitchProvider: (id: string) => void;
  onRotateProvider: () => void;
}

export function PlayerDrawers({
  panel,
  setPanel,
  item,
  episodes,
  episode,
  watchedEpisodes,
  providerId,
  compatMode,
  onToggleCompatMode,
  onGoToEpisode,
  onSwitchProvider,
  onRotateProvider,
}: PlayerDrawersProps) {
  const providers = useMemo(() => defaultProviderManager.getAll(), []);
  const drawerRef = useRef<HTMLElement>(null);
  const isDrawerOpen = panel === "episodes" || panel === "servers";

  // Focus first interactive button when episodes/servers drawer opens
  useEffect(() => {
    if (!isDrawerOpen) return;
    const raf = window.requestAnimationFrame(() => {
      const drawer = drawerRef.current;
      if (!drawer) return;
      const firstButton = drawer.querySelector<HTMLButtonElement>("button:not(:disabled)");
      firstButton?.focus();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [isDrawerOpen, panel]);

  // Accessible D-pad navigation & Back/Escape dismissal while drawer is open
  useEffect(() => {
    if (!isDrawerOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const kc = (e as unknown as { keyCode?: number }).keyCode ?? e.which;

      if (
        e.key === "Escape" ||
        e.key === "BrowserBack" ||
        e.key === "GoBack" ||
        kc === 10009 ||
        kc === 461
      ) {
        e.preventDefault();
        e.stopPropagation();
        setPanel(null);
        return;
      }

      const isUp = e.key === "ArrowUp" || kc === 38;
      const isDown = e.key === "ArrowDown" || kc === 40;
      if (!isUp && !isDown) return;

      const drawer = drawerRef.current;
      if (!drawer) return;
      const buttons = Array.from(drawer.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      if (buttons.length === 0) return;

      e.preventDefault();
      e.stopPropagation();

      const activeIdx = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const nextIdx =
        activeIdx < 0
          ? 0
          : isDown
            ? (activeIdx + 1) % buttons.length
            : (activeIdx - 1 + buttons.length) % buttons.length;

      const target = buttons[nextIdx];
      target.focus();
      target.scrollIntoView({ block: "nearest" });
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [isDrawerOpen, setPanel]);

  return (
    <>
      {/* Shared Episodes Drawer */}
      <AnimatePresence>
        {panel === "episodes" && (
          <motion.aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Episodios"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }}
            className="glass absolute inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-line"
          >
            <div className="flex items-center justify-between border-b border-line px-6 py-5">
              <h3 className="text-lg font-bold">Episodios</h3>
              <button
                type="button"
                onClick={() => setPanel(null)}
                aria-label="Cerrar episodios"
                className="rounded-full p-1.5 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto p-3">
              {episodes.map((ep) => {
                const active = ep.season === episode?.season && ep.episode === episode?.episode;
                const watched = watchedEpisodes[episodeKey(item.id, ep.season, ep.episode)];
                return (
                  <button
                    key={ep.id}
                    type="button"
                    onClick={() => onGoToEpisode(ep)}
                    className={cx(
                      "flex w-full gap-3 rounded-xl p-2.5 text-left transition hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-accent",
                      active && "bg-white/10 refract",
                    )}
                  >
                    <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-surface">
                      {ep.thumbnail && (
                        <SmartImage src={ep.thumbnail} alt="" className="size-full object-cover" />
                      )}
                      {watched && (
                        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-accent" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-dim">
                        T{ep.season}:E{ep.episode}
                        {active && <span className="ml-2 text-accent">Reproduciendo</span>}
                      </div>
                      <div className="line-clamp-2 text-sm font-semibold">{ep.title}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Shared Audio & Options Drawer (TV & Sofa Friendly) */}
      <AnimatePresence>
        {panel === "servers" && (
          <motion.aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Audio y Opciones"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
            className="glass absolute inset-y-0 right-0 z-40 flex w-full max-w-lg flex-col border-l border-line shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-line px-6 py-5">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-2xl bg-accent/20 text-accent">
                  <Languages className="size-5" />
                </span>
                <div>
                  <h3 className="text-lg font-bold text-fg">Audio y Opciones</h3>
                  <p className="text-xs text-muted">Elige tu idioma preferido o cambia de fuente</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPanel(null)}
                aria-label="Cerrar panel"
                className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-fg focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto p-5">
              {/* Modo compatible para móviles/dispositivos estrictos */}
              <button
                type="button"
                onClick={onToggleCompatMode}
                className={cx(
                  "flex w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-accent",
                  compatMode
                    ? "border-accent/40 bg-accent/15 text-fg"
                    : "border-white/10 bg-white/[0.04] text-muted hover:bg-white/[0.08] hover:text-fg",
                )}
              >
                <div className="flex items-center gap-3">
                  <ShieldCheck className={cx("size-5 shrink-0", compatMode ? "text-accent" : "text-muted")} />
                  <div>
                    <div className="text-sm font-bold text-fg">
                      Modo compatible {compatMode ? "(Activo)" : ""}
                    </div>
                    <div className="text-xs text-muted">
                      Actívalo si en tu celular o navegador el video no arranca.
                    </div>
                  </div>
                </div>
                <span
                  className={cx(
                    "rounded-full px-2.5 py-1 text-[11px] font-bold",
                    compatMode ? "bg-accent text-ink" : "bg-white/10 text-muted",
                  )}
                >
                  {compatMode ? "ON" : "OFF"}
                </span>
              </button>

              {/* Presets de 1 Clic para TV */}
              <div>
                <span className="mb-3 block text-xs font-bold tracking-wider text-dim uppercase">
                  Acceso Rápido por Idioma
                </span>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => onSwitchProvider("playlatin")}
                    className={cx(
                      "flex items-center gap-3 rounded-2xl p-4 text-left transition hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-accent",
                      providerId === "playlatin"
                        ? "bg-accent/20 text-accent ring-1 ring-accent"
                        : "bg-white/[0.05] text-fg hover:bg-white/10",
                    )}
                  >
                    <span className="text-3xl">🇲🇽</span>
                    <div>
                      <div className="text-sm font-bold">Español Latino</div>
                      <div className="text-xs text-muted">Doblaje latino y selector</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => onSwitchProvider("vidsrc_to")}
                    className={cx(
                      "flex items-center gap-3 rounded-2xl p-4 text-left transition hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-accent",
                      providerId === "vidsrc_to"
                        ? "bg-accent/20 text-accent ring-1 ring-accent"
                        : "bg-white/[0.05] text-fg hover:bg-white/10",
                    )}
                  >
                    <span className="text-3xl">🌐</span>
                    <div>
                      <div className="text-sm font-bold">Ultra HD Multi-Audio</div>
                      <div className="text-xs text-muted">Carga rápida y subtítulos</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Lista completa de opciones numeradas */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-bold tracking-wider text-dim uppercase">
                    Opciones de Reproducción (Por si una falla)
                  </span>
                  <button
                    type="button"
                    onClick={onRotateProvider}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-accent hover:underline focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    <RefreshCw className="size-3.5" /> Rotar opción (Tecla S)
                  </button>
                </div>

                <div className="space-y-2">
                  {providers.map((p, idx) => {
                    const active = p.id === providerId;
                    const circuit = defaultProviderManager.getCircuitState(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onSwitchProvider(p.id)}
                        className={cx(
                          "group/opt flex w-full items-center justify-between rounded-2xl p-4 text-left transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-accent",
                          active
                            ? "bg-white/12 text-fg refract ring-1 ring-white/20"
                            : "bg-white/[0.03] text-muted",
                        )}
                      >
                        <div className="flex items-center gap-3.5">
                          <span
                            className={cx(
                              "flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-black",
                              active
                                ? "bg-accent text-accent-ink"
                                : "bg-white/10 text-dim group-hover/opt:text-fg",
                            )}
                          >
                            {idx + 1}
                          </span>
                          <div>
                            <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-fg">
                              <span>{p.name}</span>
                              {active && (
                                <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-bold text-accent">
                                  Activa
                                </span>
                              )}
                              {circuit === "OPEN" && (
                                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                                  Inestable
                                </span>
                              )}
                              {p.requiresCompatMode && (
                                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-muted">
                                  Sin sandbox
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted">{p.audioHint}</div>
                          </div>
                        </div>
                        {active && <Check className="size-5 text-accent" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Smart TV Remote Help */}
              <div className="rounded-2xl border border-line bg-white/[0.02] p-4 text-xs text-muted">
                <div className="mb-1 font-bold text-fg">Atajos de control remoto y teclado:</div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-dim">
                  <div>• <strong className="text-fg">S</strong>: Rotar opción al instante</div>
                  <div>• <strong className="text-fg">E</strong>: Ver episodios de la serie</div>
                  <div>• <strong className="text-fg">A</strong>: Abrir este panel</div>
                  <div>• <strong className="text-fg">F</strong>: Pantalla completa</div>
                </div>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
