import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle } from "lucide-react";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { defaultProviderManager } from "../core/providers/provider.manager";
import { useBodyLock, useMeta } from "../lib/hooks";
import { actions, getProfileData, useProfileData } from "../lib/store";
import type { Episode, EpisodePointer, MediaItem, PlayerMode } from "../lib/types";
import { ui, useUi } from "../lib/ui";
import type { Panel } from "./player/PlayerControls";
import { PlayerDrawers } from "./player/PlayerDrawers";
import { StreamEngine } from "./player/StreamEngine";
import { TrailerEngine } from "./player/TrailerEngine";

class PlayerErrorBoundary extends Component<{ onClose: () => void; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-4 bg-black p-6 text-center">
        <AlertTriangle className="size-10 text-accent" />
        <h2 className="text-lg font-bold text-fg">Hubo un problema cargando el reproductor</h2>
        <p className="max-w-md text-sm text-muted">Puedes reintentar o cerrar para elegir otro título o servidor.</p>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => this.setState({ hasError: false })} className="rounded-full bg-fg px-5 py-2.5 text-xs font-bold text-ink transition hover:scale-105">
            Reintentar
          </button>
          <button type="button" onClick={this.props.onClose} className="rounded-full border border-white/20 bg-white/10 px-5 py-2.5 text-xs font-bold text-fg transition hover:bg-white/20">
            Cerrar
          </button>
        </div>
      </div>
    );
  }
}

export function Player() {
  const player = useUi((s) => s.player);
  useBodyLock(Boolean(player));
  return (
    <AnimatePresence>
      {player && (
        <PlayerErrorBoundary key={player.item.id} onClose={ui.closePlayer}>
          <PlayerView item={player.item} initialEpisode={player.episode} initialMode={player.mode} />
        </PlayerErrorBoundary>
      )}
    </AnimatePresence>
  );
}

function PlayerView({
  item,
  initialEpisode,
  initialMode,
}: {
  item: MediaItem;
  initialEpisode?: EpisodePointer;
  initialMode: PlayerMode;
}) {
  const { settings, watchedEpisodes } = useProfileData();
  const { details } = useMeta(item.type === "series" ? item : null);
  const episodes = useMemo(() => (details?.episodes ?? []).filter((e) => e.season > 0), [details]);
  const [mode, setMode] = useState<PlayerMode>(initialMode);
  const [episode, setEpisode] = useState<EpisodePointer | undefined>(() => {
    if (initialEpisode) return initialEpisode;
    if (item.type !== "series") return undefined;
    const prev = getProfileData().progress[item.id];
    return prev?.season && prev.episode ? { season: prev.season, episode: prev.episode } : { season: 1, episode: 1 };
  });

  const currentEp = episodes.find((e) => e.season === episode?.season && e.episode === episode?.episode);
  const nextEp = useMemo(() => {
    if (!episode) return undefined;
    const i = episodes.findIndex((e) => e.season === episode.season && e.episode === episode.episode);
    return i >= 0 ? episodes[i + 1] : undefined;
  }, [episodes, episode]);

  const root = useRef<HTMLDivElement>(null);
  const idle = useRef<number | undefined>(undefined);
  const [fullscreen, setFullscreen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [chrome, setChrome] = useState(true);
  const [compatMode, setCompatMode] = useState(false);
  const [providerId, setProviderId] = useState<string>(() => {
    try {
      return defaultProviderManager.resolvePlayback(settings.preferredProvider, {
        imdbId: item.id,
        type: item.type,
        season: episode?.season,
        episode: episode?.episode,
      }).providerId;
    } catch {
      return defaultProviderManager.getDefault()?.id ?? "playlatin";
    }
  });

  const showChrome = useCallback(() => {
    setChrome(true);
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => setChrome(false), 3400);
  }, []);

  useEffect(() => {
    showChrome();
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.clearTimeout(idle.current);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [showChrome]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen?.();
  }, []);

  const close = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    ui.closePlayer();
  }, []);

  const switchProvider = useCallback((nextId: string) => {
    setProviderId(nextId);
    actions.updateSettings({ preferredProvider: nextId });
    setPanel(null);
    const p = defaultProviderManager.get(nextId);
    if (p) ui.toast(`${p.shortName}: ${p.audioHint}`, "accent");
  }, []);

  const rotateNextProvider = useCallback(() => {
    switchProvider(defaultProviderManager.getNextProviderId(providerId));
  }, [providerId, switchProvider]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      showChrome();
      const kc = (e as unknown as { keyCode: number }).keyCode;
      if (e.key === "Escape" || e.key === "BrowserBack" || e.key === "GoBack" || kc === 10009 || kc === 461) {
        if (panel) setPanel(null);
        else if (!document.fullscreenElement) close();
      } else if (e.key === "f" || e.key === "F") toggleFullscreen();
      else if (e.key === "s" || e.key === "S") rotateNextProvider();
      else if ((e.key === "e" || e.key === "E") && episodes.length > 0) {
        setPanel((p) => (p === "episodes" ? null : "episodes"));
      } else if (e.key === "a" || e.key === "A" || e.key === "o" || e.key === "O") {
        setPanel((p) => (p === "servers" ? null : "servers"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, close, toggleFullscreen, showChrome, episodes.length, rotateNextProvider]);

  const goToEpisode = useCallback(
    (ep: Episode | EpisodePointer) => {
      if (episode) actions.setEpisodeWatched(item.id, episode.season, episode.episode, true);
      const next = { season: ep.season, episode: ep.episode };
      setEpisode(next);
      setPanel(null);
      const estDuration = (item.runtimeMinutes ?? (item.type === "series" ? 45 : 120)) * 60;
      actions.saveProgress(item, 0, estDuration, next);
    },
    [episode, item],
  );

  const toggleCompat = useCallback(() => setCompatMode((v) => !v), []);
  const shared = {
    item, episode, currentEp, nextEp, episodesCount: episodes.length,
    chrome, panel, setPanel, fullscreen, toggleFullscreen, onClose: close, showChrome,
  };

  return (
    <motion.div
      ref={root}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      onMouseMove={showChrome}
      className="fixed inset-0 z-[90] bg-black select-none"
    >
      {mode === "stream" ? (
        <StreamEngine
          {...shared}
          providerId={providerId}
          compatMode={compatMode}
          onToggleCompatMode={toggleCompat}
          onRotateProvider={rotateNextProvider}
          onSwitchMode={() => { setPanel(null); setMode("trailer"); }}
          onNextEpisode={nextEp ? () => goToEpisode(nextEp) : undefined}
        />
      ) : (
        <TrailerEngine
          {...shared}
          onSwitchMode={() => { setPanel(null); setMode("stream"); }}
          onGoToEpisode={goToEpisode}
        />
      )}
      <PlayerDrawers
        panel={panel} setPanel={setPanel} item={item} episodes={episodes} episode={episode}
        watchedEpisodes={watchedEpisodes} providerId={providerId} compatMode={compatMode}
        onToggleCompatMode={toggleCompat} onGoToEpisode={goToEpisode}
        onSwitchProvider={switchProvider} onRotateProvider={rotateNextProvider}
      />
    </motion.div>
  );
}
