# ClaimSync2.py — v2.4 Patch Instructions
# Two changes only. Apply in order.

## CHANGE 1 — Fix imports (remove LocalINIProvider, add nothing)

Find this line (near top of file, after httpx_soap import):
```
from config_provider import ConfigProvider, LocalINIProvider
```

Delete it entirely. ClaimSync2 loads config from DB+KV only — no INI provider needed.

---

## CHANGE 2 — Replace entire main() function

Find this line (around line 1274):
```
def main():
```

Select from `def main():` all the way to the end of the file including:
```
if __name__ == "__main__":
    main()
```

Replace with the following complete block:

```python
def main():
    # ── ClaimSync2 Cloud Engine — BAU download flow only ──────────────────
    # Config source : Azure PostgreSQL (DBConfigProvider) +
    #                 Azure Key Vault  (KeyVaultCredentialProvider)
    # No .ini file, no onboarding, no license checks, no host-lock.
    # Invocation    : python ClaimSync2.py h
    # ──────────────────────────────────────────────────────────────────────

    global fileseqno, userid, password, claims, resubmission, remittance
    global dlfh, tempfolder, systemfolder, currentsetup, config, transactionID, facility
    global hrfname, hresponsefname
    global MIN_FREE_DISK_MB
    MIN_FREE_DISK_MB = 50

    # ── Log file ───────────────────────────────────────────────────────────
    now = datetime.now()
    formatted_datetime = now.strftime("%Y-%m-%d-%H-%M-%S")
    downloadlogfile = 'downloadlog-' + formatted_datetime + '.log'
    dlfh = open(downloadlogfile, 'a')
    logline = logwriter('i', 'Pre:1.1 log file: ' + downloadlogfile + ' Opened Successfully')
    dlfh.write(f"{logline}")

    # ── Validate parameter — cloud engine only accepts h ───────────────────
    if len(sys.argv) < 2 or sys.argv[1].lower() != 'h':
        print("[ClaimSync2] Usage: python ClaimSync2.py h")
        logline = logwriter('w', 'Pre:1.2 Missing or invalid parameter — expected h')
        dlfh.write(f"{logline}")
        dlfh.close()
        return

    # ── Cloud config: DB + Key Vault ───────────────────────────────────────
    _tenant = os.environ.get('CLAIMSSYNC_TENANT', '').strip()
    _kv_uri = os.environ.get('CLAIMSSYNC_KV_URI', '').strip()

    print(f"[ClaimSync2] tenant={_tenant or '(not set)'} | kv={_kv_uri or '(not set)'}")
    logline = logwriter('i', f'Pre:1.3 tenant={_tenant or "(not set)"} kv_uri={_kv_uri or "(not set)"}')
    dlfh.write(f"{logline}")

    if not _tenant or not _kv_uri:
        print("\033[31m[ClaimSync2] FATAL: CLAIMSSYNC_TENANT or CLAIMSSYNC_KV_URI not set.\033[0m")
        logline = logwriter('c', 'Crit:1.1 CLAIMSSYNC_TENANT or CLAIMSSYNC_KV_URI env var missing — cannot start')
        dlfh.write(f"{logline}")
        dlfh.close()
        return

    try:
        from db_config_provider import DBConfigProvider
        from kv_credential_provider import KeyVaultCredentialProvider

        print(f"[ClaimSync2] ConfigProvider: DBConfigProvider | vault={_kv_uri}")
        logline = logwriter('i', f'Pre:1.4 ConfigProvider: DBConfigProvider vault={_kv_uri}')
        dlfh.write(f"{logline}")

        _kv_provider = KeyVaultCredentialProvider(vault_uri=_kv_uri)
        provider     = DBConfigProvider(
                           tenant_short_code=_tenant,
                           credential_provider=_kv_provider,
                       )
        config = provider.get_main_config()

        logline = logwriter('i', 'Pre:1.5 DB+KV config loaded successfully')
        dlfh.write(f"{logline}")

    except Exception as exc:
        print(f"\033[31m[ClaimSync2] FATAL: Config load failed — {exc}\033[0m")
        logline = logwriter('c', f'Crit:1.2 Config load failed: {exc}')
        dlfh.write(f"{logline}")
        dlfh.close()
        return

    # ── Facility loop setup ────────────────────────────────────────────────
    noofsetup  = int(config['shafaapi-main']['noofsetup'])
    tempfolder = config['shafaapi-main']['tempfolder'].strip('"')

    logline = logwriter('i', f'Pre:1.6 noofsetup={noofsetup} tempfolder={tempfolder}')
    dlfh.write(f"{logline}")

    # ── Clean temp folder ──────────────────────────────────────────────────
    try:
        os.makedirs(tempfolder, exist_ok=True)
        for file in os.listdir(tempfolder):
            if Path(file).suffix.lower() == ".xml" and \
               not Path(file).name.startswith("search_history_"):
                os.remove(tempfolder + file)
                logline = logwriter('i', 'Pre:1.7a ' + file + ' deleted from temp')
                dlfh.write(f"{logline}")
    except Exception as exc:
        logline = logwriter('w', f'Pre:1.7b temp folder cleanup warning: {exc}')
        dlfh.write(f"{logline}")

    # ── BAU facility download loop ─────────────────────────────────────────
    try:
        for currentsetup in range(1, noofsetup + 1):
            section      = f'client-config-{currentsetup}'
            userid       = config[section]['userid']
            password     = config[section]['password']
            facility     = config[section]['facility']
            claims       = config[section]['claims']
            resubmission = config[section]['resubmission']
            remittance   = config[section]['remittance']

            logline = logwriter('i', f'Pre:1.10 Facility {facility} config loaded from DB+KV')
            dlfh.write(f"{logline}")

            # ── Claims: search → list → download ──────────────────────────
            print(f"[ClaimSync2] facility={facility} setup={currentsetup} (h-claim)")
            logline = logwriter('i', f'Processing Setup: (h-claim): {currentsetup} facility={facility}')
            dlfh.write(f"{logline}")
            mainsub('h',   'y', 'claim')

            print(f"[ClaimSync2] facility={facility} setup={currentsetup} (hf-claim)")
            logline = logwriter('i', f'Processing Setup: (hf-claim): {currentsetup}')
            dlfh.write(f"{logline}")
            mainsub('hf',  'y', 'claim')

            print(f"[ClaimSync2] facility={facility} setup={currentsetup} (hff-claim)")
            logline = logwriter('i', f'Processing Setup: (hff-claim): {currentsetup}')
            dlfh.write(f"{logline}")
            mainsub('hff', 'y', 'claim')

            # ── Remittance: search → list → download ───────────────────────
            print(f"[ClaimSync2] facility={facility} setup={currentsetup} (h-remit)")
            logline = logwriter('i', f'Processing Setup: (h-remit): {currentsetup}')
            dlfh.write(f"{logline}")
            mainsub('h',   'y', 'remit')

            print(f"[ClaimSync2] facility={facility} setup={currentsetup} (hf-remit)")
            logline = logwriter('i', f'Processing Setup: (hf-remit): {currentsetup}')
            dlfh.write(f"{logline}")
            mainsub('hf',  'y', 'remit')

            print(f"[ClaimSync2] facility={facility} setup={currentsetup} (hff-remit)")
            logline = logwriter('i', f'Processing Setup: (hff-remit): {currentsetup}')
            dlfh.write(f"{logline}")
            mainsub('hff', 'y', 'remit')

    except OSError as ose:
        if ose.errno == errno.ENOSPC:
            logline = logwriter('c', 'Main:DISK-FULL OSError errno 28 — disk full. Exiting cleanly.')
            dlfh.write(f"{logline}")
            print("\033[31m*** DISK FULL — No space left on device ***\033[0m")
            print('Free up disk space and re-run. Already downloaded files are safe.')
        else:
            logline = logwriter('c', f'Main:OSError [{ose.errno}]: {ose}')
            dlfh.write(f"{logline}")
            raise

    logline = logwriter('i', 'Main:END BAU download run completed')
    dlfh.write(f"{logline}")
    dlfh.close()
    print("[ClaimSync2] BAU run complete.")


if __name__ == "__main__":
    main()
```

---

## After applying both changes — build and push

```powershell
cd D:\KaaryaaDigital\Clients\ShafaAPI\ClaimsSync\ClaimSyncDocker

docker build -t crclaimssync.azurecr.io/claimsync-engine:2.4 .
docker push crclaimssync.azurecr.io/claimsync-engine:2.4
```

## Update job image and trigger

```bash
az containerapp job update \
  --name job-claimssync-engine \
  --resource-group rg-claimssync-uaenorth-prod \
  --image crclaimssync.azurecr.io/claimsync-engine:2.4

az containerapp job start \
  --name job-claimssync-engine \
  --resource-group rg-claimssync-uaenorth-prod
```

## Pull logs (~90 sec after trigger)

```bash
az monitor log-analytics query \
  --workspace eb4827b3-0541-4fc4-991d-70d733e1c092 \
  --analytics-query "ContainerAppConsoleLogs_CL | where TimeGenerated > ago(10m) | where ContainerJobName_s == 'job-claimssync-engine' | order by time_t asc | project time_t, ContainerImage_s, Stream_s, Log_s" \
  --output table
```

## Expected log sequence (success path)

```
[ClaimSync2] tenant=KAARYAA-T1 | kv=https://kv-claimssync-uae.vault.azure.net/
[ClaimSync2] ConfigProvider: DBConfigProvider | vault=...
Pre:1.5 DB+KV config loaded successfully
Pre:1.6 noofsetup=1 tempfolder=/tmp/claimssync/
[ClaimSync2] facility=MF2618 setup=1 (h-claim)
...
Main:END BAU download run completed
```

## If config load fails — error will be explicit

```
FATAL: Config load failed — DBConfigProvider: tenant 'KAARYAA-T1' not found in DB
```
→ Seed data missing, re-run schema insert

```
FATAL: Config load failed — could not retrieve secret 'facility-mf2618-userid'
```
→ KV secret missing or RBAC issue
