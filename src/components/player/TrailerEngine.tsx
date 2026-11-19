import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Captions,
  Clapperboard,
  ExternalLink,
  Film,
  Gauge,
  ListVideo,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { cx, formatClock } from "../../lib/format";
import { actions, useProfileData } from "../../lib/store";
import type { Episode, EpisodePointer, MediaItem, ProfileSettings } from "../../lib/types";
import { loadYouTube, YT_STATE, type YTPlayer } from "../../lib/youtube";
import { SmartImage } from "../SmartImage";
import {
  CtrlButton,
  PopItem,
  Popover,
  Scrubber,
  SPEEDS,
  SUBS,
  type Panel,
} from "./PlayerControls";

export interface TrailerEngineProps {
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
  onSwitchMode: () => void;
  onGoToEpisode: (ep: Episode | EpisodePointer) => void;
  onClose: () => void;
  showChrome: () => void;
}

export function TrailerEngine({
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
  onSwitchMode,
  onGoToEpisode,
  onClose,
  showChrome,
}: TrailerEngineProps) {
  const settings = useProfileData().settings;
  const videoId = item.trailers[0];
  const host = useRef<HTMLDivElement>(null);
  const yt = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState(!videoId);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [rate, setRate] = useState(settings.playbackRate);
  const [subs, setSubs] = useState(settings.subtitles);
  const [flash, setFlash] = useState<{
    id: number;
    kind: "play" | "pause" | "back" | "fwd";
  } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const episodeRef = useRef(episode);
  episodeRef.current = episode;

  useEffect(() => {
    setCountdown(null);
    setEnded(false);
  }, [episode?.season, episode?.episode]);

  const save = useCallback(() => {
    const p = yt.current;
    if (!p?.getCurrentTime) return;
    try {
      const t = p.getCurrentTime();
      const d = p.getDuration();
      if (d > 0 && t > 1) actions.saveProgress(item, t, d, episodeRef.current);
    } catch {
      /* player torn down */
    }
  }, [item]);

  useEffect(() => {
    if (!videoId) return;
    let alive = true;
    const mount = document.createElement("div");
    host.current?.appendChild(mount);
    loadYouTube()
      .then((YT) => {
        if (!alive) return;
        yt.current = new YT.Player(mount, {
          videoId,
          width: "100%",
          height: "100%",
          host: "https://www.youtube-nocookie.com",
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            cc_load_policy: settings.subtitles === "off" ? 0 : 1,
            cc_lang_pref: settings.subtitles === "off" ? "es" : settings.subtitles,
            hl: "es",
          },
          events: {
            onReady: (e) => {
              setReady(true);
              setDuration(e.target.getDuration());
              e.target.setVolume(80);
              e.target.setPlaybackRate(settings.playbackRate);
              e.target.playVideo();
            },
            onStateChange: (e) => {
              setPlaying(e.data === YT_STATE.PLAYING);
              setBuffering(e.data === YT_STATE.BUFFERING);
              if (e.data === YT_STATE.PLAYING) {
                setEnded(false);
                setDuration(e.target.getDuration());
              }
              if (e.data === YT_STATE.ENDED) {
                setEnded(true);
                save();
              }
            },
            onError: () => setError(true),
          },
        });
      })
      .catch(() => setError(true));
    return () => {
      alive = false;
      save();
      try {
        yt.current?.destroy();
      } catch {
        /* noop */
      }
      yt.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  useEffect(() => {
    if (ready || error || !videoId) return;
    const t = window.setTimeout(() => setError(true), 15000);
    return () => window.clearTimeout(t);
  }, [ready, error, videoId]);

  useEffect(() => {
    if (!ready) return;
    let ticks = 0;
    const t = window.setInterval(() => {
      const p = yt.current;
      if (!p) return;
      try {
        setTime(p.getCurrentTime());
        if (++ticks % 20 === 0) save();
      } catch {
        /* noop */
      }
    }, 250);
    return () => window.clearInterval(t);
  }, [ready, save]);

  const visibleChrome = chrome || !playing || panel !== null || ended || error;
  const pulse = (kind: "play" | "pause" | "back" | "fwd") => setFlash({ id: Date.now(), kind });

  const toggle = useCallback(() => {
    const p = yt.current;
    if (!p || !ready) return;
    if (playing) {
      p.pauseVideo();
      pulse("pause");
      save();
    } else {
      p.playVideo();
      pulse("play");
    }
  }, [playing, ready, save]);

  const seek = useCallback(
    (to: number) => {
      const p = yt.current;
      if (!p || !ready) return;
      const clamped = Math.max(0, Math.min(duration || to, to));
      p.seekTo(clamped, true);
      setTime(clamped);
      setEnded(false);
    },
    [ready, duration],
  );

  const skip = useCallback(
    (delta: number) => {
      seek(time + delta);
      pulse(delta < 0 ? "back" : "fwd");
    },
    [seek, time],
  );

  const applyVolume = useCallback((v: number, m: boolean) => {
    const p = yt.current;
    setVolume(v);
    setMuted(m);
    if (!p) return;
    p.setVolume(v);
    if (m || v === 0) p.mute();
    else p.unMute();
  }, []);

  const applyRate = (r: number) => {
    setRate(r);
    yt.current?.setPlaybackRate(r);
    actions.updateSettings({ playbackRate: r });
  };

  const applySubs = (s: ProfileSettings["subtitles"]) => {
    setSubs(s);
    actions.updateSettings({ subtitles: s });
    const p = yt.current;
    if (!p) return;
    try {
      if (s === "off") p.unloadModule?.("captions");
      else {
        p.loadModule?.("captions");
        p.setOption?.("captions", "track", { languageCode: s });
      }
    } catch {
      /* captions unavailable */
    }
  };

  useEffect(() => {
    if (!ended) return;
    if (nextEp && settings.autoplayNext) setCountdown(6);
  }, [ended, nextEp, settings.autoplayNext]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      if (nextEp) onGoToEpisode(nextEp);
      return;
    }
    const t = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [countdown, nextEp, onGoToEpisode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.tagName === "INPUT" &&
        (e.target as HTMLInputElement).type !== "range"
      )
        return;
      showChrome();
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          toggle();
          break;
        case "ArrowLeft":
        case "j":
          e.preventDefault();
          skip(-10);
          break;
        case "ArrowRight":
        case "l":
          e.preventDefault();
          skip(10);
          break;
        case "ArrowUp":
          e.preventDefault();
          applyVolume(Math.min(100, volume + 10), false);
          break;
        case "ArrowDown":
          e.preventDefault();
          applyVolume(Math.max(0, volume - 10), volume - 10 <= 0);
          break;
        case "m":
          applyVolume(volume || 60, !muted);
          break;
        case "f":
          toggleFullscreen();
          break;
        case "c":
          applySubs(subs === "off" ? "es" : "off");
          break;
        case "Escape":
          if (panel) setPanel(null);
          else if (!document.fullscreenElement) onClose();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggle, skip, applyVolume, volume, muted, toggleFullscreen, onClose, panel, subs, showChrome]);

  const pct = duration > 0 ? (time / duration) * 100 : 0;
  const VolIcon = muted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  return (
    <div className={cx("relative size-full", !visibleChrome && "cursor-none")}>
      <div ref={host} className="pointer-events-none absolute inset-0 [&>iframe]:size-full" />

      {/* Poster while loading */}
      <AnimatePresence>
        {(!ready || (buffering && time < 0.5)) && !error && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.8 } }}
            className="absolute inset-0"
          >
            <SmartImage
              src={item.background}
              alt=""
              loading="eager"
              className="size-full object-cover opacity-60"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/40" />
            <div className="absolute inset-0 grid place-items-center">
              <div className="size-14 animate-spin rounded-full border-[3px] border-white/15 border-t-accent" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Click surface */}
      <button
        aria-label={playing ? "Pausar" : "Reproducir"}
        className="absolute inset-0 cursor-[inherit]"
        onClick={toggle}
        onDoubleClick={toggleFullscreen}
      />

      {/* Center pulse feedback */}
      <AnimatePresence>
        {flash && (
          <motion.div
            key={flash.id}
            initial={{ opacity: 0.9, scale: 0.7 }}
            animate={{ opacity: 0, scale: 1.4 }}
            transition={{ duration: 0.6 }}
            onAnimationComplete={() => setFlash(null)}
            className={cx(
              "pointer-events-none absolute top-1/2 flex size-24 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 backdrop-blur-md",
              flash.kind === "back"
                ? "left-[20%]"
                : flash.kind === "fwd"
                  ? "right-[20%]"
                  : "left-1/2 -translate-x-1/2",
            )}
          >
            {flash.kind === "play" && <Play className="ml-1 size-10 fill-fg" />}
            {flash.kind === "pause" && <Pause className="size-10 fill-fg" />}
            {flash.kind === "back" && <span className="text-lg font-bold">-10s</span>}
            {flash.kind === "fwd" && <span className="text-lg font-bold">+10s</span>}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top bar */}
      <motion.div
        animate={{ opacity: visibleChrome ? 1 : 0, y: visibleChrome ? 0 : -16 }}
        transition={{ duration: 0.35 }}
        className={cx(
          "absolute inset-x-0 top-0 flex flex-wrap items-center justify-between gap-4 bg-gradient-to-b from-black/80 to-transparent px-5 pt-5 pb-16 sm:px-8",
          !visibleChrome && "pointer-events-none",
        )}
      >
        <div className="flex min-w-0 items-center gap-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Volver"
            className="flex size-11 shrink-0 items-center justify-center rounded-full transition hover:scale-110 hover:bg-white/10"
          >
            <ArrowLeft className="size-7" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="truncate text-lg font-bold sm:text-xl">{item.title}</h2>
              <span className="shrink-0 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-accent-ink uppercase">
                Tráiler Oficial
              </span>
            </div>
            {episode && (
              <p className="truncate text-sm text-muted">
                T{episode.season}:E{episode.episode}
                {currentEp ? ` · ${currentEp.title}` : ""}
              </p>
            )}
          </div>
        </div>

        {/* Switch back to Full Movie / Episode Stream */}
        <div className="flex items-center rounded-full bg-white/[0.08] p-1 backdrop-blur-xl refract">
          <button
            type="button"
            onClick={onSwitchMode}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-muted transition hover:text-fg"
          >
            <Clapperboard className="size-3.5" />
            <span>Ver {item.type === "series" ? "episodio completo" : "película completa"}</span>
          </button>
          <button
            type="button"
            aria-pressed={true}
            className="flex items-center gap-1.5 rounded-full bg-fg px-3 py-1.5 text-xs font-bold text-ink"
          >
            <Film className="size-3.5" />
            <span>Tráiler</span>
          </button>
        </div>
      </motion.div>

      {/* Bottom controls */}
      <motion.div
        animate={{ opacity: visibleChrome ? 1 : 0, y: visibleChrome ? 0 : 20 }}
        transition={{ duration: 0.35 }}
        className={cx(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-5 pt-24 pb-5 sm:px-8 sm:pb-7",
          !visibleChrome && "pointer-events-none",
        )}
      >
        <Scrubber pct={pct} duration={duration} onSeek={(f) => seek(f * duration)} />
        <div className="mt-3 flex items-center gap-1 sm:gap-2">
          <CtrlButton
            label={playing ? "Pausar (espacio)" : "Reproducir (espacio)"}
            onClick={toggle}
          >
            {playing ? <Pause className="size-7 fill-fg" /> : <Play className="size-7 fill-fg" />}
          </CtrlButton>
          <CtrlButton label="Retroceder 10 s" onClick={() => skip(-10)}>
            <RotateCcw className="size-6" />
          </CtrlButton>
          <CtrlButton label="Adelantar 10 s" onClick={() => skip(10)}>
            <RotateCw className="size-6" />
          </CtrlButton>
          <div className="group/vol flex items-center">
            <CtrlButton label="Silenciar (m)" onClick={() => applyVolume(volume || 60, !muted)}>
              <VolIcon className="size-6" />
            </CtrlButton>
            <input
              type="range"
              min={0}
              max={100}
              value={muted ? 0 : volume}
              onChange={(e) => applyVolume(Number(e.target.value), Number(e.target.value) === 0)}
              aria-label="Volumen"
              className="w-24 origin-left -translate-x-1 accent-[var(--color-accent)] opacity-0 transition-[opacity,transform] duration-500 ease-[var(--ease-spring)] group-hover/vol:translate-x-0 group-hover/vol:opacity-100 focus:translate-x-0 focus:opacity-100"
            />
          </div>
          <span className="ml-2 text-sm font-semibold text-fg/85 tabular-nums">
            {formatClock(time)} <span className="text-dim">/ {formatClock(duration)}</span>
          </span>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <CtrlButton
              label={`Ver ${item.type === "series" ? "episodio" : "película"}`}
              onClick={onSwitchMode}
              wide
            >
              <Clapperboard className="size-5 text-accent" />
              <span className="hidden text-sm font-bold lg:inline">
                Ver {item.type === "series" ? "episodio" : "película"}
              </span>
            </CtrlButton>
            {nextEp && (
              <CtrlButton label="Siguiente episodio" onClick={() => onGoToEpisode(nextEp)} wide>
                <SkipForward className="size-6 fill-fg" />
                <span className="hidden text-sm font-bold lg:inline">Siguiente episodio</span>
              </CtrlButton>
            )}
            {episodesCount > 0 && (
              <CtrlButton
                label="Episodios"
                active={panel === "episodes"}
                onClick={() => setPanel((p) => (p === "episodes" ? null : "episodes"))}
              >
                <ListVideo className="size-6" />
              </CtrlButton>
            )}
            <div className="relative">
              <CtrlButton
                label="Subtítulos (c)"
                active={panel === "subs" || subs !== "off"}
                onClick={() => setPanel((p) => (p === "subs" ? null : "subs"))}
              >
                <Captions className="size-6" />
              </CtrlButton>
              <Popover open={panel === "subs"} title="Subtítulos">
                {SUBS.map((s) => (
                  <PopItem key={s.id} active={subs === s.id} onClick={() => applySubs(s.id)}>
                    {s.label}
                  </PopItem>
                ))}
              </Popover>
            </div>
            <div className="relative">
              <CtrlButton
                label="Velocidad"
                active={panel === "speed" || rate !== 1}
                onClick={() => setPanel((p) => (p === "speed" ? null : "speed"))}
              >
                <Gauge className="size-6" />
              </CtrlButton>
              <Popover open={panel === "speed"} title="Velocidad de reproducción">
                {SPEEDS.map((s) => (
                  <PopItem key={s} active={rate === s} onClick={() => applyRate(s)}>
                    {s === 1 ? "Normal (1x)" : `${s}x`}
                  </PopItem>
                ))}
              </Popover>
            </div>
            <CtrlButton label="Pantalla completa (f)" onClick={toggleFullscreen}>
              {fullscreen ? <Minimize className="size-6" /> : <Maximize className="size-6" />}
            </CtrlButton>
          </div>
        </div>
      </motion.div>

      {/* Autoplay next episode countdown overlay */}
      <AnimatePresence>
        {ended && countdown !== null && nextEp && !error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 grid place-items-center bg-black/70 px-6 backdrop-blur-sm"
          >
            <div className="glass max-w-md rounded-3xl border border-line p-7 text-center shadow-2xl refract">
              <p className="mb-1 text-xs font-bold tracking-wider text-accent uppercase">
                T{nextEp.season}:E{nextEp.episode} · {nextEp.title}
              </p>
              <p className="mb-6 text-xl font-bold text-fg sm:text-2xl">
                Siguiente episodio en {countdown} s
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => onGoToEpisode(nextEp)}
                  className="inline-flex items-center gap-2 rounded-full bg-fg px-6 py-3 text-sm font-bold text-ink transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <Play className="size-4 fill-ink" />
                  Reproducir ahora
                </button>
                <button
                  type="button"
                  onClick={() => setCountdown(null)}
                  className="rounded-full bg-white/15 px-6 py-3 text-sm font-bold text-fg transition hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* End screen */}
      <AnimatePresence>
        {ended && countdown === null && !error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 grid place-items-center bg-black/70 backdrop-blur-sm"
          >
            <div className="text-center">
              <p className="mb-6 text-2xl font-bold">¿Listo para ver el título completo?</p>
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={onSwitchMode}
                  className="inline-flex items-center gap-2 rounded-full bg-fg px-6 py-3 font-bold text-ink"
                >
                  <Play className="size-4 fill-ink" />
                  Ver {item.type === "series" ? "episodio" : "película"} ahora
                </button>
                <button
                  type="button"
                  onClick={() => seek(0)}
                  className="rounded-full bg-white/15 px-6 py-3 font-bold"
                >
                  Repetir tráiler
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full bg-white/15 px-6 py-3 font-bold"
                >
                  Salir
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/85 px-6">
          <div className="max-w-md text-center">
            <p className="mb-2 text-2xl font-bold">Tráiler no disponible</p>
            <p className="mb-6 text-muted">
              Puedes reproducir directamente el contenido completo en nuestros servidores.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={onSwitchMode}
                className="inline-flex items-center gap-2 rounded-full bg-fg px-5 py-3 font-bold text-ink"
              >
                <Play className="size-4 fill-ink" />
                Ver {item.type === "series" ? "episodio" : "película"}
              </button>
              {videoId && (
                <a
                  href={`https://www.youtube.com/watch?v=${videoId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-white/15 px-5 py-3 font-bold"
                >
                  Abrir en YouTube <ExternalLink className="size-4" />
                </a>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-white/15 px-5 py-3 font-bold"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
