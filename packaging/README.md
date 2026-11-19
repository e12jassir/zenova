# Zenova v3 — Guía de Despliegue (0 VPS) y Empaquetado

Guía técnica para desplegar Zenova v3 sin servidor VPS dedicado y generar paquetes nativos para **Android TV**, **LG webOS (`.ipk`)** y **Samsung Tizen (`.wgt`)**.

---

## 1. Arquitectura 0 VPS (Capa Gratuita)

Zenova separa la interfaz estática (`dist/`) de la capa serverless (`api/`) y la base de datos PostgreSQL.

### Backend y Web (Vercel Free o Cloudflare Pages) + Neon Free

1. Crea un proyecto PostgreSQL en **Neon Free** y obtén la cadena de conexión `DATABASE_URL`.
2. Despliega el repositorio en **Vercel Free** (usa `vercel.json` y `api/*` automáticamente) o **Cloudflare Pages** conectando los endpoints de `api/`.
3. Configura las siguientes variables de entorno en producción:

| Variable | Propósito |
| :--- | :--- |
| `DATABASE_URL` | URI de conexión PostgreSQL de Neon (`postgres://...`). |
| `AUTH_SECRET` | Secreto aleatorio para firmar sesiones y tokens de autenticación. |
| `STREAM_SIGNING_SECRET` | Secreto HMAC para firmar URLs temporales del proxy (`/api/stream` y `/api/hls`). |

> Las apps empaquetadas (Android TV, webOS, Tizen) se ejecutan desde origen local (`capacitor://` o `file:///`). Para que autentiquen y resuelvan streams contra tu despliegue serverless, compila definiendo `VITE_API_URL` con la URL pública de tu backend.

---

## 2. Streaming Personal 0 Anuncios sin VPS (Jellyfin + Tailscale)

Puedes servir tu propia biblioteca multimedia sin anuncios, sin abrir puertos en el router y sin contratar un VPS:

1. Instala **Jellyfin** en tu equipo doméstico o mini-PC.
2. Instala **Tailscale** en el equipo con Jellyfin y en tus dispositivos cliente (Android TV, móvil, PC).
3. Copia la URL privada (o Tailscale Serve HTTPS) asignada por Tailscale a tu instancia de Jellyfin.
4. En Zenova, abre **Ajustes → Servidor Personal** y guarda la URL Tailscale de tu servidor.

---

## 3. Empaquetado por Plataforma

Todos los scripts webOS y Tizen excluyen automáticamente artefactos pesados previos (`.apk`, `.wgt`, `.ipk`, `.zip`, `.map`) presentes en `dist/` mediante el filtro `IGNORED_ARTIFACT`.

### Android TV / Android (Capacitor + ADB)

1. Compila apuntando al backend desplegado y sincroniza el proyecto Android:
   ```bash
   VITE_API_URL=https://tu-despliegue.vercel.app npm run build && npx cap sync android
   ```
2. Genera el APK desde `android/` (o desde Android Studio):
   ```bash
   cd android && ./gradlew assembleDebug
   ```
3. Activa la depuración ADB en el televisor e instala el APK:
   ```bash
   adb connect <IP_DEL_TV>:5555
   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   ```

### LG webOS (`.ipk`)

- **Manifiesto**: `packaging/webos/appinfo.json` (`id`: `com.pelisstream.app`, `version`: `3.0.0`, `bgColor`: `#090807`, `iconColor`: `#f0a640`, `disableBackHistoryAPI`: `true`).
- **Compilación y empaquetado** (no requiere `ares-cli` para generar el `.ipk`):
  ```bash
  VITE_API_URL=https://tu-despliegue.vercel.app npm run build
  npm run package:webos
  # Salida: dist-packages/com.pelisstream.app_3.0.0_all.ipk
  ```
- **Instalación en el TV**:
  ```bash
  ares-install dist-packages/com.pelisstream.app_3.0.0_all.ipk -d <tv-device>
  ares-launch com.pelisstream.app -d <tv-device>
  ```
  *(También puedes arrastrar el `.ipk` desde webOS Dev Manager o Homebrew Channel.)*

### Samsung Tizen (`.wgt`)

- **Manifiesto**: `packaging/tizen/config.xml` (`id`: `http://pelisstream.app/PelisStream`, `tizen:application id`: `PelisStream.PelisStream`, `version`: `3.0.0`).
- **Firmado automático**: `packaging/package-tizen.js` genera y verifica `author-signature.xml` y `signature1.xml` (W3C XMLDSig) usando los certificados persistentes en `packaging/tizen/certs/`.
- **Compilación y empaquetado** (no requiere Tizen Studio para generar el `.wgt`):
  ```bash
  VITE_API_URL=https://tu-despliegue.vercel.app npm run build
  npm run package:tizen
  # Salida: dist-packages/Zenova_3.0.0.wgt
  ```
- **Instalación en el TV**:
  1. En el televisor: abre **Apps**, marca `12345` con el control remoto, activa **Developer Mode**, ingresa la IP de tu PC y reinicia el TV.
  2. Conecta por SDB e instala el paquete:
     ```bash
     sdb connect <IP_DEL_TV>:26101
     sdb install dist-packages/Zenova_3.0.0.wgt
     tizen run -p PelisStream.PelisStream
     ```

### Empaquetado Unificado (webOS + Tizen)

```bash
npm run build && npm run package
```

---

## Estructura de `packaging/`

```text
packaging/
├── webos/
│   └── appinfo.json       # Manifiesto webOS (com.pelisstream.app v3.0.0)
├── tizen/
│   ├── config.xml         # Manifiesto Tizen (http://pelisstream.app/PelisStream v3.0.0)
│   └── certs/             # Certificados RSA persistentes (author & distributor)
├── package-webos.js       # Generador nativo .ipk (ar + tar.gz)
├── package-tizen.js       # Generador y firmador XMLDSig .wgt
├── package-all.js         # Ejecuta webOS + Tizen en secuencia
└── README.md              # Esta guía
```
