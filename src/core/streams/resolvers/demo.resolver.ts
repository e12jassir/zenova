import type { IStreamResolver, StreamRequest, StreamSource } from '../types.js';

/**
 * Resolver de verificación.
 *
 * Devuelve un HLS público (Big Buck Bunny en el CDN de Mux) que cumple el mismo
 * contrato que un resolver real. Sirve para probar el pipeline completo
 * —firma, proxy, reescritura de manifest, HLS.js, teclas de Smart TV— sin
 * depender de ningún proveedor externo.
 *
 * Se activa con `STREAM_DEMO_RESOLVER=1`. Nunca corre por defecto.
 */
export class DemoStreamResolver implements IStreamResolver {
  readonly id = 'demo';
  readonly name = 'Demo HLS (público)';
  readonly priority = 999;

  canResolve(request: StreamRequest): boolean {
    return request.imdbId.trim().length > 0;
  }

  async resolve(): Promise<readonly StreamSource[]> {
    return [
      {
        providerId: this.id,
        providerName: this.name,
        url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
        kind: 'hls',
        quality: '1080p',
        language: 'en',
      },
    ];
  }
}
