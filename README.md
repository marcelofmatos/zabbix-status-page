# Zabbix Status Page

Uma **página de status** pública e leve, alimentada pela API do [Zabbix](https://www.zabbix.com/) —
no estilo das páginas de status hospedadas. Mostra a saúde geral do ambiente, o
detalhamento por componente / host group, os incidentes em aberto e o **histórico de
uptime dos últimos 90 dias** por componente.

- Página renderizada no servidor (SSR), além de `GET /api/status` (JSON) e `GET /healthz`.
- Agrupa componentes por host group do Zabbix, com um banner agregado (Operacional /
  Degradado / Interrupção parcial / Interrupção grave).
- **Degradação graciosa**: se o Zabbix ficar indisponível, mantém o último snapshot
  conhecido e marca a página como desatualizada, em vez de ficar em branco ou dar erro 500.
- Favicon dinâmico que reflete o estado mais grave atual.
- Enxuto e com poucas dependências (Node 22 + Express + EJS). Sem banco de dados — o
  histórico de uptime é um arquivo JSON num volume.

## Pré-requisitos

- **Zabbix ≥ 6.4** (autenticação por token via header `Authorization: Bearer`).
- Um **token de API** do Zabbix (veja abaixo).
- Docker (para rodar a imagem publicada) ou Node ≥ 20 (para rodar a partir do código).

## Início rápido

```bash
# 1. Configurar
cp .env.example .env
# edite o .env: defina ZABBIX_URL e ZABBIX_TOKEN (e PAGE_TITLE / TZ, se quiser)

# 2. Subir (baixa a imagem do GHCR)
docker compose up -d

# 3. Acesse http://localhost:8080
```

A imagem é publicada no GitHub Container Registry:

```bash
docker pull ghcr.io/marcelofmatos/zabbix-status-page:latest
```

## Variáveis de ambiente

| Variável | Obrigatória | Default | Descrição |
|---|---|---|---|
| `ZABBIX_URL` | sim | — | URL base do Zabbix (ex.: `https://zabbix.example.com/zabbix/`). O `api_jsonrpc.php` é derivado dela. |
| `ZABBIX_TOKEN` | sim | — | Token de API (Bearer) usado nas chamadas JSON-RPC. |
| `ZABBIX_GROUPS_IDS` | não | vazio | Lista CSV de IDs de host groups a incluir. Vazio = todos. |
| `ZABBIX_HOSTS_IDS` | não | vazio | Lista CSV de IDs de hosts a incluir. Vazio = todos. |
| `ZABBIX_STATUS_BY_GROUPS` | não | `off` | `on` agrega e exibe o status por host group. |
| `ZABBIX_KNOWLEADS` | não | `off` | `on` exibe os incidentes em aberto (problemas ativos). |
| `ZABBIX_KNOWLEADS_COMMENTS` | não | `off` | `on` inclui os comentários de reconhecimento (acknowledge) de cada incidente. |
| `PAGE_TITLE` | não | `Status` | Título exibido na página. |
| `TZ` | não | `UTC` | Fuso usado para fechar o bucket diário do histórico. |
| `PORT` | não | `8080` | Porta do servidor HTTP. |
| `POLL_INTERVAL_SECONDS` | não | `60` | Intervalo entre coletas no Zabbix. |
| `HISTORY_DAYS` | não | `90` | Janela do histórico de uptime, em dias. |
| `ZABBIX_MIN_SEVERITY` | não | `0` | Severidade mínima (0–5) considerada como problema. |
| `ZABBIX_TLS_INSECURE` | não | `off` | `on` **desativa a verificação do certificado** TLS nas chamadas ao Zabbix (aceita self-signed / cadeia incompleta). Inseguro — ver seção abaixo. |
| `HISTORY_FILE` | não | `/data/history.json` | Caminho do arquivo de histórico (definido pela imagem/stack). |
| `IMAGE_TAG` | não | `latest` | Tag da imagem usada pela stack do compose. |

## Como gerar o token do Zabbix

A página autentica por **token** (header `Authorization: Bearer`), disponível a partir do
**Zabbix 6.4**. Para gerar:

1. Faça login no frontend do Zabbix com um usuário que tenha **permissão de leitura** nos
   host groups que a página deve exibir.
2. Vá em **Users → API tokens**.
3. Clique em **Create API token** (canto superior direito).
4. Preencha:
   - **Name**: um nome identificável, ex. `status-page`.
   - **User**: o usuário cujas permissões o token herda. Prefira um usuário **somente
     leitura**, restrito apenas aos host groups exibidos (princípio do menor privilégio —
     o token enxerga exatamente o que esse usuário enxerga).
   - **Expires at**: opcional. Desmarque *"Set expiration date and time"* para um token
     sem expiração (ou defina uma data e lembre-se de renovar).
   - **Enabled**: marcado.
5. Clique em **Add**. O Zabbix exibe o **Auth token** **uma única vez** — copie.
6. Coloque no `.env`, em `ZABBIX_TOKEN=...`.

> **Segurança:** o token herda as permissões do usuário associado; para uma página
> pública, use um usuário *read-only* limitado aos grupos necessários. Para revogar,
> desabilite ou exclua o token em **Users → API tokens**.

## Certificado do Zabbix (self-signed / cadeia incompleta)

Se o Zabbix usa um certificado **auto-assinado** ou não envia a cadeia completa, o poller
falha com `UNABLE_TO_VERIFY_LEAF_SIGNATURE` ("unable to verify the first certificate").
Duas formas de resolver:

**Recomendado (seguro) — confiar na CA/certificado:** monte o certificado (ou a CA) no
container e aponte `NODE_EXTRA_CA_CERTS` para ele. Mantém a verificação TLS ativa.

```yaml
    environment:
      - NODE_EXTRA_CA_CERTS=/certs/zabbix-ca.pem
    volumes:
      - ./zabbix-ca.pem:/certs/zabbix-ca.pem:ro
```

**Rápido (inseguro) — pular a verificação:** defina `ZABBIX_TLS_INSECURE=on`. Isso desativa
a verificação do certificado **apenas** nas chamadas ao Zabbix (não afeta o resto do
processo). ⚠️ Permite ataques *man-in-the-middle* — use só em rede confiável e prefira a
opção da CA quando possível.

## Volume e permissões

O histórico de uptime é persistido em `history.json` no volume `./data` (montado em
`/data`). O container roda como `PUID:PGID` (default `1000:1000`) para conseguir gravar no
bind mount. Se `./data` pertencer a outro uid no seu host, ajuste `PUID`/`PGID` no `.env`
(ou faça `chown` do diretório) — caso contrário a gravação falha com `EACCES` e a página
fica presa como "desatualizada".

As barras de 90 dias começam vazias e vão preenchendo a partir do primeiro start
(histórico honesto — cresce até `HISTORY_DAYS`).

## Proxy reverso (opcional)

O compose padrão publica a porta `8080` diretamente. Para expor atrás de um proxy reverso
(Traefik, nginx, Caddy, …) num hostname público por HTTPS, remova o mapeamento `ports:` e
aponte seu proxy para a porta `8080` do container. Um exemplo com Traefik está incluído
(comentado) no `docker-compose.yml`.

## Versionamento e releases

As imagens são versionadas em SemVer (`x.y.z`) mais `latest`, publicadas no GHCR pelo
workflow **Release and build** do GitHub Actions (Actions → *Release and build* → Run
workflow → `patch` / `minor` / `major`). Cada execução cria um release e publica:

```
ghcr.io/marcelofmatos/zabbix-status-page:<x.y.z>
ghcr.io/marcelofmatos/zabbix-status-page:<x.y>
ghcr.io/marcelofmatos/zabbix-status-page:<x>
ghcr.io/marcelofmatos/zabbix-status-page:latest
```

Fixe `IMAGE_TAG` no `.env` numa versão específica para deploys reprodutíveis / rollback.

## Desenvolvimento

```bash
npm install
npm test        # node --test (testes unitários, sem rede)
npm start       # sobe o servidor (precisa de um .env válido)
```

## Arquitetura

Veja [docs/ARQUITETURA.md](docs/ARQUITETURA.md) para os diagramas de arquitetura e fluxo.

## Licença

[MIT](LICENSE)
