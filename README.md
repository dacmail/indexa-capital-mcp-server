# indexa-capital-mcp-server

Servidor MCP de **solo lectura** para monitorizar tus inversiones en [Indexa Capital](https://indexacapital.com) desde Claude (Desktop, Code, web).

Implementa el subconjunto de lectura de la [API REST v1.6 de Indexa](https://indexacapital.com/en/api-rest-v1):

| Tool MCP | Endpoint | Para qué sirve |
|---|---|---|
| `indexa_portfolio_summary` | varios | Resumen agregado de todas tus cuentas en una sola llamada |
| `indexa_get_me` | `GET /users/me` | Lista de cuentas y datos del usuario |
| `indexa_get_account` | `GET /accounts/{id}` | Perfil de la cuenta, riesgo, titulares |
| `indexa_get_portfolio` | `GET /accounts/{id}/portfolio` | Composición actual: valor, fondos, ISIN, P/L |
| `indexa_get_performance` | `GET /accounts/{id}/performance` | Serie histórica de rentabilidad y benchmark |
| `indexa_get_transactions` | `GET /accounts/{id}/transactions` | Movimientos: aportaciones, suscripciones, retiradas |
| `indexa_get_fees` | `GET /accounts/{id}/fees` | Comisiones de gestión por trimestre |

> **Nota de seguridad**: este servidor no implementa ningún endpoint de escritura (no puede mover dinero, abrir cuentas, ni modificar tu perfil). Si en el futuro quieres añadir aportaciones programadas o transferencias, requiere un fork explícito.

## Requisitos

- Node.js 18 o superior
- Una cuenta en Indexa Capital
- Un token de API personal (instrucciones más abajo)

## Instalación

### Desde npm (usuarios)

No hace falta clonar ni compilar: el paquete incluye el código ya construido en `dist/`.

Instalación global (el binario queda en tu PATH de npm):

```bash
npm install -g indexa-capital-mcp-server
```

O ejecutarlo sin instalar globalmente (`npx` descarga el paquete cuando hace falta; `-y` evita el prompt de confirmación):

```bash
npx -y indexa-capital-mcp-server
```

### Desde el repositorio (desarrollo)

```bash
git clone https://github.com/dacmail/indexa-capital-mcp-server.git
cd indexa-capital-mcp-server
npm install
npm run build
```

## Obtener el token de API

1. Entra en tu área privada de Indexa Capital.
2. Ve a **Configuración de usuario → Aplicaciones**.
3. Genera un token. Tendrá esta pinta: `eyJ0eXAiOiJKV1Qi...`.
4. **Guárdalo a buen recaudo**: es personal, intransferible, y suficiente para acceder a todos los datos de tu cuenta.

## Configuración en Claude Desktop

Edita `~/Library/Application Support/Claude/claude_desktop_config.json` y añade una de estas opciones.

**Con `npx` (recomendado; no necesitas ruta al clon ni al global `node_modules`):**

```json
{
  "mcpServers": {
    "indexa-capital": {
      "command": "npx",
      "args": ["-y", "indexa-capital-mcp-server"],
      "env": {
        "INDEXA_API_TOKEN": "eyJ0eXAiOiJKV1Qi..."
      }
    }
  }
}
```

**Si instalaste el paquete con `npm install -g`:**

```json
{
  "mcpServers": {
    "indexa-capital": {
      "command": "indexa-capital-mcp-server",
      "args": [],
      "env": {
        "INDEXA_API_TOKEN": "eyJ0eXAiOiJKV1Qi..."
      }
    }
  }
}
```

**Si trabajas desde un clon local** (tras `npm run build`):

```json
{
  "mcpServers": {
    "indexa-capital": {
      "command": "node",
      "args": ["/ruta/absoluta/a/indexa-capital-mcp-server/dist/index.js"],
      "env": {
        "INDEXA_API_TOKEN": "eyJ0eXAiOiJKV1Qi..."
      }
    }
  }
}
```

Reinicia Claude Desktop. Verás las 7 tools disponibles bajo el icono del enchufe.

## Configuración en Claude Code

Con paquete publicado en npm (`npx`):

```bash
claude mcp add indexa-capital \
  --env INDEXA_API_TOKEN=eyJ0eXAiOiJKV1Qi... \
  -- npx -y indexa-capital-mcp-server
```

Con instalación global:

```bash
claude mcp add indexa-capital \
  --env INDEXA_API_TOKEN=eyJ0eXAiOiJKV1Qi... \
  -- indexa-capital-mcp-server
```

Desde un clon local:

```bash
claude mcp add indexa-capital \
  --env INDEXA_API_TOKEN=eyJ0eXAiOiJKV1Qi... \
  -- node /ruta/absoluta/a/indexa-capital-mcp-server/dist/index.js
```

## Ejemplos de uso

Una vez conectado, puedes preguntarle a Claude cosas como:

- _"¿Cómo van mis inversiones en Indexa?"_ — usa `indexa_portfolio_summary`
- _"¿Qué fondos tengo en mi cartera de Indexa?"_ — usa `indexa_get_portfolio`
- _"¿Cuánto he ganado este año en mi plan de pensiones?"_ — usa `indexa_get_performance` con `date_from`
- _"Lista las aportaciones que hice en 2024"_ — usa `indexa_get_transactions` con filtro de fechas
- _"¿Cuánto me ha cobrado Indexa en comisiones desde que abrí la cuenta?"_ — usa `indexa_get_fees`

## Pruebas locales

```bash
# Compilar
npm run build

# Test rápido del token
INDEXA_API_TOKEN=eyJ... node -e "
  const axios = require('axios');
  axios.get('https://api.indexacapital.com/users/me', {
    headers: { 'X-AUTH-TOKEN': process.env.INDEXA_API_TOKEN }
  }).then(r => console.log(JSON.stringify(r.data, null, 2)));
"

# Inspector MCP oficial
npx @modelcontextprotocol/inspector node dist/index.js
```

(Recuerda exportar `INDEXA_API_TOKEN` antes de lanzar el inspector.)

## Estructura del proyecto

```
src/
├── index.ts              # Entry point, registro de tools
├── constants.ts          # API URL, headers, límites
├── schemas/
│   └── common.ts         # Schemas Zod compartidos
├── services/
│   ├── client.ts         # Cliente Axios + manejo de errores
│   └── format.ts         # Helpers de formato (Markdown/JSON/EUR)
└── tools/
    ├── get_me.ts
    ├── get_account.ts
    ├── get_portfolio.ts
    ├── get_performance.ts
    ├── get_transactions.ts
    ├── get_fees.ts
    └── portfolio_summary.ts
```

## Notas sobre la API

- El base URL es `https://api.indexacapital.com`.
- La autenticación se hace con el header `X-AUTH-TOKEN`.
- Los tokens generados desde el área privada **no caducan**, a diferencia de los tokens emitidos vía `/auth/authenticate` que duran ~16 h.
- Los endpoints `/portfolio`, `/performance`, `/transactions` y `/fees` no aparecen en la documentación pública RAML pero están confirmados por el soporte oficial y por clientes existentes (Indexa-Dashboard, plantillas Google Sheets, integraciones de la suite Sure). Las interfaces TypeScript son intencionalmente permisivas (`?` opcional, `[key: string]: unknown`) por si la API evoluciona.

## Licencia

MIT.
