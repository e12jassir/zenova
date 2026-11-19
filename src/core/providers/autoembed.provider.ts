import {
  SHARED_ALLOW_ATTRIBUTES,
  SHARED_SANDBOX_FLAGS,
  episodeOf,
  isValidPlaybackRequest,
  seasonOf,
  type IVideoProviderStrategy,
  type PlaybackRequest,
  type PlaybackResolution,
} from './provider.interface';

/** AutoEmbed: Multi-audio (Latino / Castellano / English). Rejects sandboxed iframes upstream. */
export class AutoEmbedProvider implements IVideoProviderStrategy {
  readonly id = 'autoembed';
  readonly name = 'Opción 5: AutoEmbed (Multi · Compat)';
  readonly shortName = 'Opción 5';
  readonly audioHint = 'Multi · Latino';
  readonly priority = 5;
  readonly requiresCompatMode = true;

  canHandle(request: PlaybackRequest): boolean {
    return isValidPlaybackRequest(request);
  }

  resolve(request: PlaybackRequest): PlaybackResolution {
    const imdbId = encodeURIComponent(request.imdbId.trim());
    const embedUrl =
      request.type === 'series'
        ? `https://player.autoembed.me/embed/tv/${imdbId}/${seasonOf(request)}/${episodeOf(request)}`
        : `https://player.autoembed.me/embed/movie/${imdbId}`;

    return {
      providerId: this.id,
      providerName: this.name,
      audioHint: this.audioHint,
      embedUrl,
      sandboxFlags: SHARED_SANDBOX_FLAGS,
      allowAttributes: SHARED_ALLOW_ATTRIBUTES,
      requiresCompatMode: true,
    };
  }
}
