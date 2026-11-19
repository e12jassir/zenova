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

export class TwoEmbedProvider implements IVideoProviderStrategy {
  readonly id = 'twoembed';
  readonly name = 'Opción 4: Alternativa (Multi · Sub)';
  readonly shortName = 'Opción 4';
  readonly audioHint = 'Multi · Sub';
  readonly priority = 4;

  canHandle(request: PlaybackRequest): boolean {
    return isValidPlaybackRequest(request);
  }

  resolve(request: PlaybackRequest): PlaybackResolution {
    const imdbId = encodeURIComponent(request.imdbId.trim());
    const embedUrl =
      request.type === 'series'
        ? `https://www.2embed.cc/embedtv/${imdbId}&s=${seasonOf(request)}&e=${episodeOf(request)}`
        : `https://www.2embed.cc/embed/${imdbId}`;

    return {
      providerId: this.id,
      providerName: this.name,
      audioHint: this.audioHint,
      embedUrl,
      sandboxFlags: SHARED_SANDBOX_FLAGS,
      allowAttributes: SHARED_ALLOW_ATTRIBUTES,
    };
  }
}
