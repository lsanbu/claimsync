# httpx_soap.py
# ClaimSync Phase 0 — SOAP over HTTPS via httpx (replaces curl subprocess)
#
# Purpose:
#   Provides two synchronous helper functions that fire SOAP requests to the
#   Shafafiya API and write the response XML to disk — exactly as curl did,
#   but without shell=True, subprocess.Popen, or process.communicate().
#
#   Both functions are blocking (synchronous httpx.Client) so the call sequence
#   in mainsub() and DownloadHistoryTxnFile() is unchanged — no async/await needed.
#
# Functions:
#   soap_search_transactions()   — replaces curl in build_and_execute_search_request()
#   soap_download_transaction()  — replaces curl in DownloadHistoryTxnFile()
#
# Dependencies:
#   httpx  (listed in requirements.txt)
#
# Change History:
#   v1.0  Anbu  11-Mar-2026  Phase 0 initial

import httpx

# Shafafiya SOAP endpoint — same URL that was hard-coded in every curl command
SHAFAFIYA_ENDPOINT = "https://shafafiya.doh.gov.ae/v3/webservices.asmx"

# Request timeout in seconds.
# curl had no explicit timeout so it could hang indefinitely on a slow response.
# 60s connect + 120s read covers the largest observed responses with margin.
_CONNECT_TIMEOUT = 60.0
_READ_TIMEOUT    = 120.0


def soap_search_transactions(
        req_fname: str,
        resp_fname: str,
        interval_idx: int,
        logwriter,
        dlfh) -> str | None:
    """
    POST the SearchTransactions SOAP request file to the Shafafiya endpoint
    and write the response body to resp_fname.

    Replaces this curl block in build_and_execute_search_request():
        curl -X POST
             -H "Content-Type: text/xml; charset=utf-8"
             -H "SOAPAction: https://www.shafafiya.org/v2/SearchTransactions"
             -d @<req_fname>
             -o <resp_fname>
             "https://shafafiya.doh.gov.ae/v3/webservices.asmx"

    Args:
        req_fname    (str):  Full path to the SOAP request XML file (already written by caller).
        resp_fname   (str):  Full path where the SOAP response XML should be saved.
        interval_idx (int):  Zero-based interval index — used only for log messages.
        logwriter    (func): logwriter(level, message) function from main script.
        dlfh         (file): Open log file handle from main script.

    Returns:
        str:  resp_fname on success (mirrors curl contract — caller checks truthiness).
        None: on any HTTP or connection error.
    """
    logline = logwriter('i', f'His:Intv[{interval_idx}] httpx POST SearchTransactions | req: {req_fname}')
    dlfh.write(logline)

    try:
        with open(req_fname, 'rb') as f:
            request_body = f.read()
    except OSError as e:
        logline = logwriter('w', f'His:Intv[{interval_idx}] httpx: cannot read request file {req_fname}: {e}')
        dlfh.write(logline)
        return None

    headers = {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction':   'https://www.shafafiya.org/v2/SearchTransactions',
    }

    try:
        with httpx.Client(timeout=httpx.Timeout(_READ_TIMEOUT, connect=_CONNECT_TIMEOUT)) as client:
            response = client.post(SHAFAFIYA_ENDPOINT, content=request_body, headers=headers)
    except httpx.TimeoutException as e:
        logline = logwriter('w', f'His:Intv[{interval_idx}] httpx TIMEOUT SearchTransactions: {e}')
        dlfh.write(logline)
        return None
    except httpx.RequestError as e:
        logline = logwriter('w', f'His:Intv[{interval_idx}] httpx REQUEST ERROR SearchTransactions: {e}')
        dlfh.write(logline)
        return None

    if response.status_code != 200:
        logline = logwriter('w', f'His:Intv[{interval_idx}] httpx HTTP {response.status_code} SearchTransactions')
        dlfh.write(logline)
        return None

    try:
        with open(resp_fname, 'wb') as f:
            f.write(response.content)
    except OSError as e:
        logline = logwriter('w', f'His:Intv[{interval_idx}] httpx: cannot write response file {resp_fname}: {e}')
        dlfh.write(logline)
        return None

    # v8g parity: Check Shafafiya SearchTransactionsResult in response body.
    # HTTP 200 does not mean success — Shafafiya embeds error codes in SOAP body:
    #   -3  invalid parameter  |  -5  date range > 100 days  |  -10  no criteria
    # Non-zero → log warning and return None (interval counted as failed).
    try:
        resp_text = response.content.decode('utf-8', errors='replace').replace('\n', ' ')
        sr_start  = resp_text.find('<SearchTransactionsResult>')
        sr_end    = resp_text.find('</SearchTransactionsResult>')
        if sr_start > 0 and sr_end > sr_start:
            sr_code = resp_text[sr_start + 26 : sr_end].strip()
            if sr_code != '0':
                logline = logwriter('w', f'His:Intv[{interval_idx}] Shafafiya SearchTransactionsResult={sr_code} — interval skipped')
                dlfh.write(logline)
                return None
    except Exception:
        pass   # If check fails, fall through — GetHistoryTxnFileDownload handles gracefully

    logline = logwriter('i', f'His:Intv[{interval_idx}] httpx SearchTransactions OK | resp: {resp_fname} | {len(response.content)} bytes')
    dlfh.write(logline)
    return resp_fname


def soap_download_transaction(
        req_fname: str,
        resp_fname: str,
        logwriter,
        dlfh) -> str | None:
    """
    POST the DownloadTransactionFile SOAP request file to the Shafafiya endpoint
    and write the response body to resp_fname.

    Replaces this curl block in DownloadHistoryTxnFile():
        curl -X POST
             -H "Content-Type: text/xml; charset=utf-8"
             -H "SOAPAction: https://www.shafafiya.org/v2/DownloadTransactionFile"
             -d @<req_fname>
             -o <resp_fname>
             "https://shafafiya.doh.gov.ae/v3/webservices.asmx"

    The caller (DownloadHistoryTxnFile) reads resp_fname immediately after this
    returns — the file must exist and contain the full SOAP response body.

    Args:
        req_fname  (str):  Full path to the DownloadTransactionFile SOAP request XML.
        resp_fname (str):  Full path where the SOAP response XML should be saved.
        logwriter  (func): logwriter(level, message) from main script.
        dlfh       (file): Open log file handle from main script.

    Returns:
        str:  resp_fname on success.
        None: on any HTTP or connection error (caller returns '' to skip this FileID).
    """
    logline = logwriter('i', f'Dnld:1.5h httpx POST DownloadTransactionFile | req: {req_fname}')
    dlfh.write(logline)

    try:
        with open(req_fname, 'rb') as f:
            request_body = f.read()
    except OSError as e:
        logline = logwriter('w', f'Dnld:httpx: cannot read request file {req_fname}: {e}')
        dlfh.write(logline)
        return None

    headers = {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction':   'https://www.shafafiya.org/v2/DownloadTransactionFile',
    }

    try:
        with httpx.Client(timeout=httpx.Timeout(_READ_TIMEOUT, connect=_CONNECT_TIMEOUT)) as client:
            response = client.post(SHAFAFIYA_ENDPOINT, content=request_body, headers=headers)
    except httpx.TimeoutException as e:
        logline = logwriter('w', f'Dnld:httpx TIMEOUT DownloadTransactionFile | req: {req_fname}: {e}')
        dlfh.write(logline)
        return None
    except httpx.RequestError as e:
        logline = logwriter('w', f'Dnld:httpx REQUEST ERROR DownloadTransactionFile | req: {req_fname}: {e}')
        dlfh.write(logline)
        return None

    if response.status_code != 200:
        logline = logwriter('w', f'Dnld:httpx HTTP {response.status_code} DownloadTransactionFile | req: {req_fname}')
        dlfh.write(logline)
        return None

    try:
        with open(resp_fname, 'wb') as f:
            f.write(response.content)
    except OSError as e:
        logline = logwriter('w', f'Dnld:httpx: cannot write response file {resp_fname}: {e}')
        dlfh.write(logline)
        return None

    logline = logwriter('i', f'Dnld:1.6h httpx DownloadTransactionFile OK | resp: {resp_fname} | {len(response.content)} bytes')
    dlfh.write(logline)
    return resp_fname
