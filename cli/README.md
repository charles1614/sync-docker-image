# sync-docker-image-cli

Command line client for the [Docker image sync](https://github.com/charles1614/sync-docker-image)
web service. Trigger a sync to your own registry, then watch it finish — without
leaving the terminal.

Zero runtime dependencies. Node 18+.

## Install

```bash
npm install -g sync-docker-image-cli
```

## Log in

Generate a token in the web UI at `https://<your-app>/tokens`, then:

```bash
sdi login https://your-app.vercel.app
```

Paste the token at the prompt — it is not echoed, so it stays out of your shell
history. For non-interactive logins, pipe it instead of passing `--token`:

```bash
cat token.txt | sdi login https://your-app.vercel.app --token-stdin
```

The token is stored in `~/.config/sync-docker-image/config.json` (mode `0600`).
For CI, skip `login` and export environment variables instead:

```bash
export SDI_URL=https://your-app.vercel.app
export SDI_TOKEN=sdi_xxxxxxxx
```

## Use

```bash
# Sync one tag. The destination defaults to the registry/namespace
# configured on the server.
sdi copy nginx:1.27

# Block until it finishes, showing which GitHub Actions step is running
sdi copy ghcr.io/owner/app:v1 --wait

# Choose the destination explicitly
sdi copy nvcr.io/nvidia/pytorch:24.05-py3 team/pytorch:24.05 --wait

# Sync every tag of a repository
sdi sync nginx team

# Wait, then pull the result locally
sdi copy redis:7 --wait --pull

# Inspect jobs
sdi list
sdi list --status failed
sdi status <job-id> --wait
sdi rm <job-id>
```

## Scripting and agents

Every command accepts `--json`, which writes a single JSON document to stdout
and sends all human-readable output to stderr:

```bash
IMAGE=$(sdi copy redis:7 --wait --json | jq -r '.destination')
docker pull "$IMAGE"
```

Exit codes are stable:

| Code | Meaning                          |
| ---- | -------------------------------- |
| `0`  | success                          |
| `1`  | network, server or auth error    |
| `2`  | bad arguments                    |
| `3`  | the sync itself failed           |
| `4`  | `--wait` timed out (still running) |

```bash
sdi copy nginx:1.27 --wait --json > result.json
case $? in
  0) echo "synced: $(jq -r .destination result.json)" ;;
  3) echo "failed: $(jq -r .job.logs_url result.json)" ;;
  4) echo "still running, check later" ;;
  *) echo "error" ;;
esac
```

`--wait` polls every 5s and gives up after 30 minutes; tune with `--interval`
and `--timeout` (both in seconds). The interval widens automatically as the wait
goes on (10s after a minute, 30s after five) so long waits do not exhaust the
server's GitHub API quota; passing `--interval` pins it. A failed poll is
retried — only five consecutive failures abort the wait.

## Commands

| Command                  | Description                                  |
| ------------------------ | -------------------------------------------- |
| `sdi login [url]`        | Save the web app URL and an API token        |
| `sdi logout`             | Forget saved credentials                     |
| `sdi whoami`             | Show who the current token belongs to        |
| `sdi config`             | Show the resolved configuration              |
| `sdi copy <src> [dest]`  | Sync a single tag                            |
| `sdi sync <src> [dest]`  | Sync every tag of a repository               |
| `sdi status <job-id>`    | Job status and step-by-step progress         |
| `sdi list`               | List recent jobs                             |
| `sdi rm <job-id>...`     | Delete jobs                                  |

Run `sdi help` for the full flag reference.

## Environment

| Variable         | Purpose                                    |
| ---------------- | ------------------------------------------ |
| `SDI_URL`        | Web app URL (overrides the config file)    |
| `SDI_TOKEN`      | API token (overrides the config file)      |
| `SDI_CONFIG_DIR` | Directory holding `config.json`            |
| `NO_COLOR`       | Disable coloured output                    |

## License

MIT
