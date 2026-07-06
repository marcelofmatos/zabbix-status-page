# Arquitetura e Fluxo

## Arquitetura

Um único serviço Node roda um servidor HTTP e um poller em background. O poller consulta a
API JSON-RPC do Zabbix, monta um snapshot, mantém-no em memória e persiste um histórico de
uptime (janela rolante) num arquivo JSON num volume. O servidor renderiza a página (SSR) e
expõe um endpoint JSON e um health check.

```mermaid
flowchart LR
  Browser["Navegador"] -->|"HTTPS"| Proxy["Proxy reverso (opcional)"]
  Proxy -->|"porta 8080"| App["status app<br/>Node 22 + Express"]
  App -->|"SSR HTML + /api/status"| Browser
  Poller["Poller interno<br/>setInterval"] -->|"JSON-RPC + Bearer"| Zabbix["API do Zabbix<br/>api_jsonrpc.php"]
  Poller --> Snapshot["Snapshot em memória"]
  Poller --> Hist["history.json<br/>volume ./data"]
  App --> Snapshot
  App --> Hist
```

## Fluxo

A cada tick, o poller busca o estado atual no Zabbix, mapeia severidades para estados de
componente, agrega por host group, atualiza o bucket do dia no histórico e publica o
snapshot. Em caso de falha, mantém o snapshot anterior e marca a página como desatualizada.

```mermaid
flowchart TD
  A["Tick a cada POLL_INTERVAL_SECONDS"] --> B["hostgroup.get filtra GROUPS_IDS"]
  B --> C["host.get filtra grupos/HOSTS_IDS selectHostGroups"]
  C --> D["trigger.get value 1 selectHosts priority"]
  D --> E["problem.get recent false selectAcknowledges"]
  E --> F["Mapear severidade Zabbix para estado"]
  F --> G["Agregar componente para grupo para banner geral"]
  G --> H["Atualizar bucket do dia no history.json"]
  H --> I["Publicar snapshot em memória"]
  I --> J["Se Zabbix falhar mantem ultimo snapshot marca stale"]
```
