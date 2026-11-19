import '@vidstack/react/player/styles/default/theme.css';
import '@vidstack/react/player/styles/default/layouts/video.css';
import {
  isHLSProvider,
  MediaPlayer,
  MediaProvider,
  Track,
  useMediaState,
  type MediaPlayerInstance,
  type MediaProviderAdapter,
  type PlayerSrc,
} from '@vidstack/react';
import { defaultLayoutIcons, DefaultVideoLayout } from '@vidstack/react/player/layouts/default';
import Hls from 'hls.js';
import { ArrowLeft, Languages, SkipForward, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export interface NativePlayerSubtitle {
  url: string;
  label: string;
  lang: string;
  default?: boolean;
}

export interface NativePlayerProps {
  /** Enlace directo al stream HLS (.m3u8) o MP4 */
  streamUrl: string;
  /** Formato del stream resuelto */
  kind?: 'hls' | 'mp4';
  /** Etiqueta del proveedor para mostrar en la barra superior */
  providerLabel?: string;
  /** Tiempo inicial en segundos para reanudar reproducción */
  initialTime?: number;
  /** Callback para persistir progreso real de reproducción */
  onProgress?: (currentTime: number, duration: number) => void;
  /** Pistas de subtítulos opcionales */
  subtitles?: NativePlayerSubtitle[];
  /** Título principal de la película o serie */
  title: string;
  /** Imagen de fondo o póster */
  backdrop?: string;
  /** Texto descriptivo del episodio (ej. "T1:E3 · El Comienzo") */
  episodeText?: string;
  /** Callback para avanzar al siguiente episodio */
  onNextEpisode?: () => void;
  /** Callback opcional para cambiar a servidores web alternativos */
  onSwitchToIframe?: () => void;
  /** Callback para cerrar el reproductor */
  onClose: () => void;
}

/**
 * NativePlayer — Reproductor nativo de Zenova de alto rendimiento
 * basado en Vidstack y HLS.js con soporte exhaustivo para Smart TV y desktop.
 */
export function NativePlayer({
  streamUrl,
  kind,
  providerLabel,
  initialTime,
  onProgress,
  subtitles,
  title,
  backdrop,
  episodeText,
  onNextEpisode,
  onSwitchToIframe,
  onClose,
}: NativePlayerProps) {
  const playerRef = useRef<MediaPlayerInstance>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  const [userActive, setUserActive] = useState(true);
  const idleTimer = useRef<number | undefined>(undefined);

  const appliedInitialSeekRef = useRef(false);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const lastReportedTimeRef = useRef(0);
  const lastReportedAtRef = useRef(0);
  const lastKnownPosRef = useRef<{ time: number; duration: number }>({ time: 0, duration: 0 });

  const mediaSrc = useMemo<PlayerSrc>(() => {
    if (kind === 'mp4') return { src: streamUrl, type: 'video/mp4' };
    if (kind === 'hls') return { src: streamUrl, type: 'application/x-mpegurl' };
    return streamUrl;
  }, [streamUrl, kind]);

  useEffect(() => {
    appliedInitialSeekRef.current = false;
  }, [streamUrl, initialTime]);

  const tryInitialSeek = useCallback(() => {
    if (appliedInitialSeekRef.current) return;
    const player = playerRef.current;
    if (!player || !initialTime || initialTime <= 10) return;
    const duration = player.duration;
    if (Number.isFinite(duration) && duration > 0 && initialTime >= duration * 0.95) {
      appliedInitialSeekRef.current = true;
      return;
    }
    player.currentTime = initialTime;
    appliedInitialSeekRef.current = true;
  }, [initialTime]);

  const reportProgress = useCallback((t: number, d: number, force = false) => {
    if (!Number.isFinite(t) || !Number.isFinite(d) || d <= 0) return;
    lastKnownPosRef.current = { time: t, duration: d };
    const now = Date.now();
    const timeDelta = Math.abs(t - lastReportedTimeRef.current);
    const elapsed = now - lastReportedAtRef.current;
    if (!force && elapsed < 20_000 && timeDelta < 15) return;
    lastReportedTimeRef.current = t;
    lastReportedAtRef.current = now;
    onProgressRef.current?.(t, d);
  }, []);

  useLayoutEffect(() => {
    lastReportedTimeRef.current = 0;
    lastReportedAtRef.current = 0;
    lastKnownPosRef.current = { time: 0, duration: 0 };
    return () => {
      const player = playerRef.current;
      const t = player ? player.currentTime : lastKnownPosRef.current.time;
      const d = player ? player.duration : lastKnownPosRef.current.duration;
      if (Number.isFinite(t) && Number.isFinite(d) && d > 0 && t > 0) {
        onProgressRef.current?.(t, d);
      }
    };
  }, [streamUrl]);

  // Vidstack internal controls visibility signal
  const isPlayerControlsVisible = useMediaState('controlsVisible', playerRef);
  const isVisible = userActive || isPlayerControlsVisible;

  const showChrome = useCallback(() => {
    setUserActive(true);
    if (idleTimer.current) {
      window.clearTimeout(idleTimer.current);
    }
    idleTimer.current = window.setTimeout(() => {
      setUserActive(false);
    }, 3500);
  }, []);

  useEffect(() => {
    showChrome();
    return () => {
      if (idleTimer.current) {
        window.clearTimeout(idleTimer.current);
      }
    };
  }, [showChrome]);

  // Cierre limpio saliendo de pantalla completa si estuviera activa
  const handleClose = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    onClose();
  }, [onClose]);

  // Configuración de HLS.js bundled para Smart TV y navegadores sin CDN externo
  const handleProviderChange = useCallback((provider: MediaProviderAdapter | null) => {
    if (isHLSProvider(provider)) {
      provider.library = Hls;
    }
  }, []);

  // Mapeo exhaustivo de teclas de Smart TV (Tizen, webOS, Android) y Teclado
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      showChrome();

      const kc = (e as unknown as { keyCode?: number }).keyCode ?? e.which;

      // Botón Atrás en Smart TVs: Tizen 10009, webOS 461, Android 4, Escape 27, BrowserBack, GoBack
      if (
        e.key === 'Escape' ||
        e.key === 'BrowserBack' ||
        e.key === 'GoBack' ||
        kc === 10009 ||
        kc === 461 ||
        kc === 27 ||
        kc === 4
      ) {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
        return;
      }

      // Tecla F: Alternar pantalla completa
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        const player = playerRef.current;
        if (player) {
          if (player.state.fullscreen || Boolean(document.fullscreenElement)) {
            void player.exitFullscreen();
          } else {
            void player.enterFullscreen();
          }
        }
        return;
      }

      // Evitar interceptar si el usuario está interactuando con un input de texto
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Permitir navegación D-pad dentro de la barra superior (Volver / Servidores Web / Siguiente)
      const activeEl = document.activeElement;
      if (
        activeEl &&
        headerRef.current?.contains(activeEl) &&
        (e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight' ||
          e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          kc === 37 ||
          kc === 38 ||
          kc === 39 ||
          kc === 40)
      ) {
        return;
      }

      const player = playerRef.current;
      if (!player) return;

      // Flecha izquierda: Retroceder 10s
      if (e.key === 'ArrowLeft' || kc === 37) {
        e.preventDefault();
        player.currentTime = Math.max(0, player.currentTime - 10);
        return;
      }

      // Flecha derecha: Avanzar 10s
      if (e.key === 'ArrowRight' || kc === 39) {
        e.preventDefault();
        const duration = player.duration;
        player.currentTime = Math.min(
          Number.isFinite(duration) && duration > 0 ? duration : Infinity,
          player.currentTime + 10,
        );
        return;
      }

      // Flecha arriba: Subir volumen (+10%)
      if (e.key === 'ArrowUp' || kc === 38) {
        e.preventDefault();
        player.volume = Math.min(1, Math.round((player.volume + 0.1) * 10) / 10);
        return;
      }

      // Flecha abajo: Bajar volumen (-10%)
      if (e.key === 'ArrowDown' || kc === 40) {
        e.preventDefault();
        player.volume = Math.max(0, Math.round((player.volume - 0.1) * 10) / 10);
        return;
      }

      // Botón OK / Espacio: Play / Pausa
      if (
        e.key === 'Enter' ||
        e.key === ' ' ||
        e.code === 'Space' ||
        kc === 13 ||
        kc === 32
      ) {
        // Si el foco activo está en un botón interactivo, dejamos actuar el evento nativo
        if (document.activeElement instanceof HTMLButtonElement) {
          return;
        }
        e.preventDefault();
        if (player.paused) {
          void player.play();
        } else {
          void player.pause();
        }
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [handleClose, showChrome]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black select-none overflow-hidden"
      onMouseMove={showChrome}
      onTouchStart={showChrome}
    >
      <MediaPlayer
        ref={playerRef}
        src={mediaSrc}
        title={title}
        poster={backdrop}
        viewType="video"
        streamType="on-demand"
        logLevel="warn"
        /*
         * Sin `crossOrigin="anonymous"` a propósito.
         *
         * Ese atributo obliga al navegador a exigir CORS en la respuesta del
         * video. Nuestro HLS va por `/api/hls` (mismo origen, no lo necesita) y
         * Archive sirve sus mp4 desde un CDN que NO manda
         * `Access-Control-Allow-Origin`: con el atributo, el video nunca carga.
         *
         * Si algún día se reproducen subtítulos desde otro dominio, hay que
         * pasarlos por el proxy antes de agregarlos aquí.
         */
        playsInline
        autoPlay
        load="eager"
        onProviderChange={handleProviderChange}
        onLoadedMetadata={tryInitialSeek}
        onCanPlay={tryInitialSeek}
        onTimeUpdate={(detail) => {
          const player = playerRef.current;
          const t = detail.currentTime;
          const d = player?.duration ?? 0;
          if (d > 0) {
            lastKnownPosRef.current = { time: t, duration: d };
          }
          reportProgress(t, d, false);
        }}
        onPause={() => {
          const player = playerRef.current;
          if (!player) return;
          reportProgress(player.currentTime, player.duration, true);
        }}
        onEnded={() => {
          const player = playerRef.current;
          if (!player) return;
          const d = player.duration;
          if (d > 0) {
            reportProgress(d, d, true);
          }
        }}
        className="size-full aspect-auto bg-black"
      >
        <MediaProvider className="size-full">
          {subtitles?.map((sub, index) => (
            <Track
              key={`${sub.url}-${sub.lang}-${index}`}
              src={sub.url}
              kind="subtitles"
              label={sub.label}
              lang={sub.lang}
              default={sub.default}
              type={sub.url.endsWith('.srt') ? 'srt' : 'vtt'}
            />
          ))}
        </MediaProvider>

        {/* Layout oficial de Vidstack para video con controles limpios */}
        <DefaultVideoLayout icons={defaultLayoutIcons} colorScheme="dark" />

        {/* Top Bar Cinematográfico estilo Zenova (vidrio esmerilado, desenfoque y minimalismo) */}
        <div
          ref={headerRef}
          className={`absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-4 bg-gradient-to-b from-black/95 via-black/60 to-transparent px-4 pt-4 pb-12 sm:px-8 sm:pt-6 transition-all duration-300 ease-out ${
            isVisible
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 -translate-y-2 pointer-events-none'
          }`}
        >
          {/* Lado izquierdo: Botón volver + Título + Badge + Episodio */}
          <div className="flex min-w-0 items-center gap-3.5 sm:gap-4">
            <button
              type="button"
              onClick={handleClose}
              aria-label="Volver"
              className="flex size-11 sm:size-12 shrink-0 items-center justify-center rounded-full bg-white/10 backdrop-blur-xl border border-white/10 text-white shadow-xl transition-all duration-200 hover:scale-105 hover:bg-white/20 active:scale-95 focus:outline-none focus:ring-2 focus:ring-accent refract cursor-pointer"
            >
              <ArrowLeft className="size-5 sm:size-6" />
            </button>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-bold text-white sm:text-xl drop-shadow-md">
                  {title}
                </h2>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent/20 px-2.5 py-0.5 text-[11px] font-bold text-accent ring-1 ring-accent/40 backdrop-blur-md">
                  <Sparkles className="size-3" />
                  {providerLabel ?? (kind === 'mp4' ? 'Directo · MP4' : 'Directo · HLS')}
                </span>
              </div>
              {episodeText && (
                <p className="truncate text-xs font-medium text-white/75 sm:text-sm drop-shadow mt-0.5">
                  {episodeText}
                </p>
              )}
            </div>
          </div>

          {/* Lado derecho: Botones de servidores web y Siguiente Episodio */}
          <div className="flex items-center gap-2">
            {onSwitchToIframe && (
              <button
                type="button"
                onClick={onSwitchToIframe}
                aria-label="Servidores web alternativos"
                title="Cambiar a servidores web (iframe)"
                className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white/90 backdrop-blur-xl border border-white/10 shadow-xl transition-all duration-200 hover:scale-105 hover:bg-white/20 active:scale-95 focus:outline-none focus:ring-2 focus:ring-accent refract cursor-pointer"
              >
                <Languages className="size-4 text-accent" />
                <span className="hidden sm:inline">Servidores Web</span>
              </button>
            )}

            {onNextEpisode && (
              <button
                type="button"
                onClick={onNextEpisode}
                aria-label="Siguiente episodio"
                className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs sm:text-sm font-semibold text-white backdrop-blur-xl border border-white/10 shadow-xl transition-all duration-200 hover:scale-105 hover:bg-white/20 active:scale-95 focus:outline-none focus:ring-2 focus:ring-accent refract cursor-pointer"
              >
                <span>Siguiente</span>
                <SkipForward className="size-4" />
              </button>
            )}
          </div>
        </div>
      </MediaPlayer>
    </div>
  );
}

export default NativePlayer;
