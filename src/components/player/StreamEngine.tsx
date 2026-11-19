import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  ArrowLeft,
  Clapperboard,
  Film,
  Languages,
  ListVideo,
  Maximize,
  Minimize,
  RefreshCw,
  ShieldCheck,
  SkipForward,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { PlaybackResolution } from "../../core/providers/provider.interface";
import { defaultProviderManager } from "../../core/providers/provider.manager";
import { cx } from "../../lib/format";
import { useNativeStream } from "../../lib/native-stream";
import { actions, getProfileData } from "../../lib/store";
import type { Episode, EpisodePointer, MediaItem } from "../../lib/types";
import { ui } from "../../lib/ui";
import { NativePlayer } from "../NativePlayer";
import { SmartImage } from "../SmartImage";
import type { Panel } from "./PlayerControls";

/**
 * Margen para que el servidor o Jellyfin busque una fuente nativa antes de montar
 * el iframe. Corto a propósito: si no hay respuesta, el iframe arranca igual.
 */
const NATIVE_GRACE_MS = 1500;

export interface StreamEngineProps {
  item: MediaItem;
  episode?: EpisodePointer;
  currentEp?: Episode;
  nextEp?: Episode;
  episodesCount: number;
  chrome: boolean;
  panel: Panel;
  setPanel: Dispatch<SetStateAction<Panel>>;
  fullscreen: boolean;
  toggleFullscreen: () => void;
  providerId: string;
  compatMode: boolean;
  onToggleCompatMode: () => void;
  onRotateProvider: () => void;
  onSwitchMode: () => void;
  onNextEpisode?: () => void;
  onClose: () => void;
  showChrome: () => void;
}

export function StreamEngine({
  item,
  episode,
  currentEp,
  nextEp,
  episodesCount,
  chrome,
  panel,
  setPanel,
  fullscreen,
  toggleFullscreen,
  providerId,
  compatMode,
  onToggleCompatMode,
  onRotateProvider,
  onSwitchMode,
  onNextEpisode,
  onClose,
  showChrome,
}: StreamEngineProps) {
  const resolution = useMemo<PlaybackResolution | null>(() => {
    try {
      return defaultProviderManager.resolvePlayback(providerId, {
        imdbId: item.id,
        type: item.type,
        season: episode?.season,
        episode: episode?.episode,
      });
    } catch {
      return null;
    }
  }, [providerId, item.id, item.type, episode?.season, episode?.episode]);

  const effectiveCompatMode = compatMode || Boolean(resolution?.requiresCompatMode);

  const native = useNativeStream(item, episode);
  const [forceIframe, setForceIframe] = useState(false);

  useEffect(() => {
    setForceIframe(false);
  }, [native.source?.url, item.id, episode?.season, episode?.episode]);

  const [nativeBudgetSpent, setNativeBudgetSpent] = useState(false);
  useEffect(() => {
    setNativeBudgetSpent(false);
  }, [item.id, episode?.season, episode?.episode]);

  useEffect(() => {
    if (!native.loading) return;
    setNativeBudgetSpent(false);
    const timer = window.setTimeout(() => setNativeBudgetSpent(true), NATIVE_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [native.loading, item.id, episode?.season, episode?.episode]);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const mountTimeRef = useRef<number>(Date.now());
  const watchdogTimer = useRef<number | undefined>(undefined);
  const savedIframeKeyRef = useRef<string>("");
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [slowWarning, setSlowWarning] = useState(false);

  const handleRotate = () => {
    const elapsed = Date.now() - mountTimeRef.current;
    if (resolution && (!iframeLoaded || slowWarning || elapsed < 25_000)) {
      defaultProviderManager.reportFailure(resolution.providerId);
    }
    onRotateProvider();
  };

  // Track loading, fast reveal timer, watchdog ref, and confirmed healthy session (25s)
  useEffect(() => {
    setIframeLoaded(false);
    setSlowWarning(false);
    mountTimeRef.current = Date.now();
    window.clearTimeout(watchdogTimer.current);

    if (!resolution) return;

    const fastRevealTimer = window.setTimeout(() => {
      setIframeLoaded(true);
    }, 1800);

    watchdogTimer.current = window.setTimeout(() => {
      setSlowWarning(true);
    }, 5000);

    const healthyTimer = window.setTimeout(() => {
      defaultProviderManager.reportSuccess(resolution.providerId);
    }, 25_000);

    return () => {
      window.clearTimeout(fastRevealTimer);
      window.clearTimeout(watchdogTimer.current);
      watchdogTimer.current = undefined;
      window.clearTimeout(healthyTimer);
    };
  }, [resolution?.embedUrl, effectiveCompatMode, resolution]);

  const nativeInitialTime = useMemo(() => {
    const prev = getProfileData().progress[item.id];
    if (!prev || prev.completed) return undefined;
    const sameEp =
      !episode || (prev.season === episode.season && prev.episode === episode.episode);
    return sameEp && prev.position > 10 ? prev.position : undefined;
  }, [item.id, episode?.season, episode?.episode]);

  const usingNativePlayer = Boolean(native.source && !forceIframe);
  const waitingNativeBudget = native.loading && !nativeBudgetSpent && !forceIframe;
  const usingIframe = Boolean(resolution) && !usingNativePlayer && !waitingNativeBudget;
  const episodeProgressKey = `${item.id}:${episode?.season ?? ""}:${episode?.episode ?? ""}`;

  // En modo iframe guarda una única entrada de progreso al abrir o cambiar de episodio
  useEffect(() => {
    if (!usingIframe) return;
    if (savedIframeKeyRef.current === episodeProgressKey) return;
    savedIframeKeyRef.current = episodeProgressKey;

    const estDuration = (item.runtimeMinutes ?? (item.type === "series" ? 45 : 120)) * 60;
    const prev = getProfileData().progress[item.id];
    const sameEp =
      !episode || (prev?.season === episode.season && prev?.episode === episode.episode);
    const existingPos =
      prev && !prev.completed && sameEp && prev.position > 30 ? prev.position : 90;

    actions.saveProgress(item, existingPos, estDuration, episode);
  }, [usingIframe, episodeProgressKey, item, episode]);

  // Active Shield: Intercept rogue popups & block window.open ad traps
  useEffect(() => {
    const originalOpen = window.open;
    try {
      window.open = () => null;
    } catch {
      /* window.open might be read-only in strict environments */
    }
    return () => {
      try {
        window.open = originalOpen;
      } catch {
        /* ignore */
      }
    };
  }, []);

  const visibleChrome = chrome || panel !== null || !iframeLoaded || slowWarning || !resolution;
  const activeStrategy = resolution ? defaultProviderManager.get(resolution.providerId) : undefined;

  if (native.source && !forceIframe) {
    return (
      <NativePlayer
        streamUrl={native.source.url}
        kind={native.source.kind}
        providerLabel={native.source.providerName}
        subtitles={[...native.source.subtitles]}
        title={item.title}
        backdrop={item.background}
        episodeText={episode ? `T${episode.season}:E${episode.episode}` : undefined}
        initialTime={nativeInitialTime}
        onProgress={(pos, dur) => actions.saveProgress(item, pos, dur, episode)}
        onNextEpisode={onNextEpisode}
        onSwitchToIframe={() => setForceIframe(true)}
        onClose={onClose}
      />
    );
  }

  if (waitingNativeBudget) {
    return (
      <div className="relative flex size-full items-center justify-center overflow-hidden bg-black">
        <SmartImage
          src={item.background}
          alt=""
          loading="eager"
          className="absolute inset-0 size-full object-cover opacity-50"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/40" />
        <div className="relative flex flex-col items-center gap-4 px-4 text-center">
          <div className="size-14 animate-spin rounded-full border-[3px] border-white/15 border-t-accent" />
          <p className="text-sm font-bold tracking-wide text-fg">
            Buscando fuente sin anuncios…
          </p>
          <p className="max-w-xs text-xs text-muted">
            Si no aparece, seguimos con el reproductor de siempre.
          </p>
        </div>
      </div>
    );
  }

  if (!resolution) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-4 bg-black p-6 text-center">
        <AlertTriangle className="size-10 text-accent" />
        <h2 className="text-lg font-bold text-fg">No hay fuente de video válida para {item.title}</h2>
        <p className="max-w-md text-sm text-muted">
          Este título no tiene un identificador de reproducción válido en este momento.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {item.trailers.length > 0 && (
            <button
              type="button"
              onClick={onSwitchMode}
              className="rounded-full bg-fg px-5 py-2.5 text-xs font-bold text-ink transition hover:scale-105"
            >
              Ver tráiler
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/20 bg-white/10 px-5 py-2.5 text-xs font-bold text-fg transition hover:bg-white/20"
          >
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative size-full overflow-hidden bg-black">
      {/* Top hover sensor so moving cursor to top edge over cross-origin iframe always reveals chrome */}
      <div
        onMouseEnter={showChrome}
        onMouseMove={showChrome}
        className="fixed inset-x-0 top-0 z-30 h-14 bg-transparent"
      />

      {/* Streaming Iframe con aislamiento de sandbox estricto (o modo compatible cuando el proveedor lo requiere) */}
      <iframe
        ref={iframeRef}
        key={`${resolution.embedUrl}:${effectiveCompatMode ? "compat" : "safe"}`}
        src={resolution.embedUrl}
        title={`Reproductor Zenova — ${item.title}`}
        sandbox={effectiveCompatMode ? undefined : resolution.sandboxFlags}
        allow={resolution.allowAttributes}
        referrerPolicy="origin-when-cross-origin"
        allowFullScreen
        onLoad={() => {
          window.clearTimeout(watchdogTimer.current);
          watchdogTimer.current = undefined;
          setIframeLoaded(true);
          setSlowWarning(false);
        }}
        onError={() => {
          window.clearTimeout(watchdogTimer.current);
          watchdogTimer.current = undefined;
          defaultProviderManager.reportFailure(resolution.providerId);
          setIframeLoaded(true);
          setSlowWarning(true);
        }}
        className="absolute inset-0 size-full border-0 bg-black"
      />

      {/* Backdrop while connecting to server */}
      <AnimatePresence>
        {!iframeLoaded && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.6 } }}
            className="pointer-events-none absolute inset-0 z-10"
          >
            <SmartImage
              src={item.background}
              alt=""
              loading="eager"
              className="size-full object-cover opacity-60"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/40" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-4">
              <div className="size-14 animate-spin rounded-full border-[3px] border-white/15 border-t-accent" />
              <div className="text-center">
                <p className="text-sm font-bold tracking-wide text-fg">
                  Conectando con {activeStrategy?.shortName ?? resolution.providerName}…
                </p>
                <p className="mt-1 text-xs text-muted">
                  Audio {resolution.audioHint} ·{" "}
                  {effectiveCompatMode ? "Modo compatible (Sin sandbox)" : "Sandbox blindado activo"}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={handleRotate}
                  className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold text-fg backdrop-blur-md transition hover:scale-105 hover:bg-white/20 active:scale-95"
                >
                  <RefreshCw className="size-3.5" />
                  <span>¿Tarda en cargar? Probar otra opción (S)</span>
                </button>
                {!effectiveCompatMode && (
                  <button
                    type="button"
                    onClick={() => {
                      onToggleCompatMode();
                      ui.toast("Modo compatible activado");
                    }}
                    className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/50 px-4 py-2 text-xs font-semibold text-muted backdrop-blur-md transition hover:text-fg"
                  >
                    <ShieldCheck className="size-3.5" />
                    <span>¿No carga en tu dispositivo? Modo compatible</span>
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 5-Second Watchdog Failover Banner */}
      <AnimatePresence>
        {slowWarning && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12 }}
            className="glass absolute bottom-6 left-1/2 z-30 flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center justify-center gap-2.5 rounded-3xl px-4 py-2.5 shadow-2xl sm:bottom-8 sm:rounded-full sm:px-5 sm:py-3 refract"
          >
            <AlertTriangle className="size-4 shrink-0 text-accent" />
            <span className="text-xs font-semibold text-fg sm:text-sm">
              ¿No carga o salió error?
            </span>
            <button
              type="button"
              onClick={handleRotate}
              className="inline-flex items-center gap-1.5 rounded-full bg-fg px-3.5 py-1.5 text-xs font-bold text-ink transition hover:scale-105"
            >
              <RefreshCw className="size-3.5" />
              Probar otra opción (S)
            </button>
            {!effectiveCompatMode && (
              <button
                type="button"
                onClick={() => {
                  onToggleCompatMode();
                  setSlowWarning(false);
                  ui.toast("Modo compatible activado");
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-fg transition hover:bg-white/20"
              >
                <ShieldCheck className="size-3.5" />
                Modo compatible
              </button>
            )}
            <button
              type="button"
              onClick={() => setSlowWarning(false)}
              aria-label="Ocultar aviso"
              className="rounded-full p-1 text-muted hover:text-fg"
            >
              <X className="size-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Chrome Bar (Title + Server Switcher + Episodes + Mode Switcher) */}
      <motion.div
        animate={{ opacity: visibleChrome ? 1 : 0, y: visibleChrome ? 0 : -20 }}
        transition={{ duration: 0.35 }}
        className={cx(
          "absolute inset-x-0 top-0 z-30 flex flex-wrap items-center justify-between gap-4 bg-gradient-to-b from-black/90 via-black/65 to-transparent px-4 pt-4 pb-12 sm:px-7 sm:pt-5",
          !visibleChrome && "pointer-events-none",
        )}
      >
        {/* Left: Back + Title + Server Badge */}
        <div className="flex min-w-0 items-center gap-3.5">
          <button
            type="button"
            onClick={onClose}
            aria-label="Volver"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/10 backdrop-blur-xl transition hover:scale-105 hover:bg-white/20 refract"
          >
            <ArrowLeft className="size-6" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-bold sm:text-xl">{item.title}</h2>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/20 px-2.5 py-0.5 text-[11px] font-bold text-accent ring-1 ring-accent/40">
                <ShieldCheck className="size-3" />
                {activeStrategy?.shortName ?? "Servidor"} · {resolution.audioHint}
                {effectiveCompatMode ? " · Compat" : ""}
              </span>
            </div>
            {episode && (
              <p className="truncate text-xs text-muted sm:text-sm">
                T{episode.season}:E{episode.episode}
                {currentEp ? ` · ${currentEp.title}` : ""}
              </p>
            )}
          </div>
        </div>

        {/* Right: Mode Toggle + Server Selector + Next Episode + Episodes Drawer + Fullscreen */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Stream vs Trailer Mode Pill */}
          {item.trailers.length > 0 && (
            <div className="flex items-center rounded-full bg-white/[0.08] p-1 backdrop-blur-xl refract">
              <button
                type="button"
                aria-pressed={true}
                className="flex items-center gap-1.5 rounded-full bg-fg px-3 py-1.5 text-xs font-bold text-ink"
              >
                <Clapperboard className="size-3.5" />
                <span>{item.type === "series" ? "Episodio" : "Película"}</span>
              </button>
              <button
                type="button"
                onClick={onSwitchMode}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-muted transition hover:text-fg"
              >
                <Film className="size-3.5" />
                <span>Tráiler</span>
              </button>
            </div>
          )}

          {/* Audio & Server Options Trigger (Opens unified TV drawer) */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPanel((p) => (p === "servers" ? null : "servers"))}
              aria-expanded={panel === "servers"}
              className={cx(
                "flex h-10 items-center gap-2 rounded-full px-4 text-xs font-bold backdrop-blur-xl transition sm:text-sm refract focus:ring-2 focus:ring-accent",
                panel === "servers"
                  ? "bg-fg text-ink"
                  : "bg-white/10 text-fg hover:bg-white/20",
              )}
            >
              <Languages className="size-4 text-accent" />
              <span>{activeStrategy?.shortName ?? "Audio y Opciones"}</span>
            </button>

            {/* Quick Rotate Option Button */}
            <button
              type="button"
              onClick={handleRotate}
              title="Rotar opción si no reproduce (Tecla S)"
              aria-label="Rotar opción si no reproduce (Tecla S)"
              className="flex size-10 items-center justify-center rounded-full bg-white/10 text-fg backdrop-blur-xl transition hover:scale-105 hover:bg-white/20 focus:ring-2 focus:ring-accent refract"
            >
              <RefreshCw className="size-4" />
            </button>
          </div>

          {/* Next Episode Button */}
          {onNextEpisode && nextEp && (
            <button
              type="button"
              onClick={onNextEpisode}
              title={`Siguiente: T${nextEp.season}:E${nextEp.episode}`}
              className="flex h-10 items-center gap-2 rounded-full bg-white/10 px-3.5 text-xs font-bold text-fg backdrop-blur-xl transition hover:bg-white/20 sm:text-sm refract"
            >
              <SkipForward className="size-4 fill-fg" />
              <span className="hidden md:inline">Sig. episodio</span>
            </button>
          )}

          {/* Episodes Drawer Toggle */}
          {episodesCount > 0 && (
            <button
              type="button"
              onClick={() => setPanel((p) => (p === "episodes" ? null : "episodes"))}
              aria-label="Lista de episodios"
              title="Episodios"
              className={cx(
                "flex h-10 items-center gap-2 rounded-full px-3.5 text-xs font-bold backdrop-blur-xl transition sm:text-sm refract",
                panel === "episodes"
                  ? "bg-fg text-ink"
                  : "bg-white/10 text-fg hover:bg-white/20",
              )}
            >
              <ListVideo className="size-4" />
              <span className="hidden sm:inline">Episodios</span>
            </button>
          )}

          {/* Fullscreen Toggle */}
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label="Pantalla completa (f)"
            title="Pantalla completa (f)"
            className="flex size-10 items-center justify-center rounded-full bg-white/10 text-fg backdrop-blur-xl transition hover:scale-105 hover:bg-white/20 refract"
          >
            {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
