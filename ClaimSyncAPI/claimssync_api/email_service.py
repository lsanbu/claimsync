"""
email_service.py — Azure Communication Services email for ClaimSync
--------------------------------------------------------------------
Sends branded credential-entry emails to facility contacts.
Fails gracefully — never crashes the calling endpoint.

Env vars:
  CLAIMSSYNC_ACS_CONNECTION_STRING  — ACS resource connection string
  CLAIMSSYNC_ACS_SENDER_ADDRESS     — verified sender (e.g. DoNotReply@...)
"""

import os
import logging

log = logging.getLogger(__name__)

ACS_CONNECTION_STRING = os.getenv("CLAIMSSYNC_ACS_CONNECTION_STRING", "")
ACS_SENDER_ADDRESS    = os.getenv("CLAIMSSYNC_ACS_SENDER_ADDRESS", "")


def send_credential_email(
    to_email: str,
    facility_name: str,
    facility_code: str,
    credential_url: str,
    expires_days: int = 7,
    is_resend: bool = False,
) -> bool:
    """
    Send a branded credential-entry email via Azure Communication Services.
    Returns True on success, False on failure (never raises).
    """
    if not ACS_CONNECTION_STRING or not ACS_SENDER_ADDRESS:
        log.warning("ACS not configured — skipping email to %s", to_email)
        return False

    subject = (
        f"{'[Resent] ' if is_resend else ''}ClaimSync — Enter credentials for {facility_name} ({facility_code})"
    )

    html_body = _build_html(facility_name, facility_code, credential_url, expires_days, is_resend)
    plain_body = _build_plain(facility_name, facility_code, credential_url, expires_days, is_resend)

    try:
        from azure.communication.email import EmailClient

        client = EmailClient.from_connection_string(ACS_CONNECTION_STRING)

        message = {
            "senderAddress": ACS_SENDER_ADDRESS,
            "recipients": {
                "to": [{"address": to_email}],
            },
            "content": {
                "subject": subject,
                "html": html_body,
                "plainText": plain_body,
            },
        }

        poller = client.begin_send(message)
        result = poller.result()
        msg_id = getattr(result, "message_id", None) or "unknown"
        log.info("Email sent to %s for %s (message_id=%s)", to_email, facility_code, msg_id)
        return True

    except Exception:
        log.exception("Failed to send email to %s for %s", to_email, facility_code)
        return False


def _build_html(
    facility_name: str,
    facility_code: str,
    credential_url: str,
    expires_days: int,
    is_resend: bool,
) -> str:
    resend_banner = ""
    if is_resend:
        resend_banner = """
        <tr><td style="background:#FFF3CD;padding:12px 24px;text-align:center;
                        font-size:14px;color:#856404;border-radius:6px;">
            This is a re-sent link. Any previous credential links for this facility have been cancelled.
        </td></tr>
        <tr><td style="height:16px"></td></tr>
        """

    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F4F4F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F5;padding:40px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

  <!-- Header -->
  <tr><td style="background:#0F6E56;padding:32px 40px;text-align:center;">
    <h1 style="margin:0;color:#FFFFFF;font-size:24px;font-weight:700;letter-spacing:-0.5px;">ClaimSync</h1>
    <p style="margin:8px 0 0;color:#A7F3D0;font-size:13px;">Shafafiya Claims Automation</p>
  </td></tr>

  <tr><td style="padding:32px 40px;">
    {resend_banner}

    <!-- Facility badge -->
    <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
    <tr>
      <td style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:8px;padding:12px 20px;">
        <span style="color:#065F46;font-size:13px;font-weight:600;">{facility_name}</span>
        <span style="color:#059669;font-size:12px;margin-left:8px;background:#D1FAE5;padding:2px 8px;border-radius:4px;">{facility_code}</span>
      </td>
    </tr>
    </table>

    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Your ClaimSync account has been approved. Please click the button below to securely enter
      your Shafafiya portal credentials. These will be encrypted and stored in Azure Key Vault.
    </p>

    <!-- CTA Button -->
    <table cellpadding="0" cellspacing="0" style="margin:28px 0;" width="100%">
    <tr><td align="center">
      <a href="{credential_url}" target="_blank"
         style="display:inline-block;background:#0F6E56;color:#FFFFFF;text-decoration:none;
                padding:14px 36px;border-radius:8px;font-size:15px;font-weight:600;
                letter-spacing:0.3px;">
        Enter Shafafiya Credentials
      </a>
    </td></tr>
    </table>

    <p style="color:#6B7280;font-size:13px;line-height:1.5;margin:0 0 8px;">
      This link expires in <strong>{expires_days} days</strong>. After expiry, contact your
      ClaimSync representative for a new link.
    </p>

    <!-- Security note -->
    <table cellpadding="0" cellspacing="0" style="margin-top:24px;" width="100%">
    <tr><td style="background:#F9FAFB;border-left:3px solid #0F6E56;padding:12px 16px;border-radius:0 6px 6px 0;">
      <p style="color:#6B7280;font-size:12px;line-height:1.5;margin:0;">
        <strong style="color:#374151;">Security note:</strong> Your credentials are transmitted over
        TLS and stored encrypted in Azure Key Vault. ClaimSync staff cannot view your password.
        If you did not request this, please ignore this email.
      </p>
    </td></tr>
    </table>

  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#F9FAFB;padding:20px 40px;text-align:center;border-top:1px solid #E5E7EB;">
    <p style="color:#9CA3AF;font-size:11px;margin:0;">
      ClaimSync by Kaaryaa Intelligence LLP &bull; Abu Dhabi, UAE
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>"""


def _build_plain(
    facility_name: str,
    facility_code: str,
    credential_url: str,
    expires_days: int,
    is_resend: bool,
) -> str:
    resend_note = (
        "\n[RESENT] Any previous credential links for this facility have been cancelled.\n"
        if is_resend else ""
    )
    return f"""ClaimSync — Credential Entry
{'=' * 40}
{resend_note}
Facility: {facility_name} ({facility_code})

Your ClaimSync account has been approved. Please visit the link below to securely enter your Shafafiya portal credentials:

{credential_url}

This link expires in {expires_days} days. After expiry, contact your ClaimSync representative for a new link.

Security: Your credentials are transmitted over TLS and stored encrypted in Azure Key Vault. ClaimSync staff cannot view your password.

---
ClaimSync by Kaaryaa Intelligence LLP | Abu Dhabi, UAE
"""


def send_auth_failed_facility_email(
    to_email: str,
    facility_code: str,
    facility_name: str,
    credential_url: str,
    auth_failed_time: str,
) -> bool:
    """
    Notify facility contact that their Shafafiya credentials need updating.
    Returns True on success, False on failure (never raises).
    """
    if not ACS_CONNECTION_STRING or not ACS_SENDER_ADDRESS:
        log.warning("ACS not configured — skipping auth-failed facility email to %s", to_email)
        return False

    subject = f"Action Required — Update ClaimSync credentials for {facility_name} ({facility_code})"
    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F4F4F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F5;padding:40px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <tr><td style="background:#B91C1C;padding:32px 40px;text-align:center;">
    <h1 style="margin:0;color:#FFFFFF;font-size:24px;font-weight:700;">ClaimSync — Action Required</h1>
    <p style="margin:8px 0 0;color:#FCA5A5;font-size:13px;">Shafafiya Claims Automation</p>
  </td></tr>
  <tr><td style="padding:32px 40px;">
    <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
    <tr><td style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:12px 20px;">
      <span style="color:#991B1B;font-size:13px;font-weight:600;">{facility_name}</span>
      <span style="color:#DC2626;font-size:12px;margin-left:8px;background:#FEE2E2;padding:2px 8px;border-radius:4px;">{facility_code}</span>
    </td></tr>
    </table>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px;">
      Your Shafafiya credentials may have changed. ClaimSync was unable to download your insurance claims
      on <strong>{auth_failed_time}</strong>.
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 24px;">
      Please update your credentials using the button below. Claim syncing will resume automatically
      at the next scheduled run (06:00 UAE time).
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:28px 0;" width="100%">
    <tr><td align="center">
      <a href="{credential_url}" target="_blank"
         style="display:inline-block;background:#B91C1C;color:#FFFFFF;text-decoration:none;
                padding:14px 36px;border-radius:8px;font-size:15px;font-weight:600;">
        Update Shafafiya Credentials
      </a>
    </td></tr>
    </table>
    <p style="color:#6B7280;font-size:13px;line-height:1.5;margin:0 0 8px;">
      This link expires in <strong>7 days</strong>. If you did not change your Shafafiya password,
      please contact your ClaimSync representative.
    </p>
  </td></tr>
  <tr><td style="background:#F9FAFB;padding:20px 40px;text-align:center;border-top:1px solid #E5E7EB;">
    <p style="color:#9CA3AF;font-size:11px;margin:0;">ClaimSync by Kaaryaa Intelligence LLP &bull; Abu Dhabi, UAE</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""

    plain_body = f"""ClaimSync — Action Required: Update Credentials
{'=' * 50}

Facility: {facility_name} ({facility_code})

Your Shafafiya credentials may have changed. ClaimSync was unable to download your insurance claims on {auth_failed_time}.

Please update your credentials at:
{credential_url}

This link expires in 7 days. Claim syncing will resume automatically at the next scheduled run (06:00 UAE time).

---
ClaimSync by Kaaryaa Intelligence LLP | Abu Dhabi, UAE
"""

    try:
        from azure.communication.email import EmailClient
        client = EmailClient.from_connection_string(ACS_CONNECTION_STRING)
        message = {
            "senderAddress": ACS_SENDER_ADDRESS,
            "recipients": {"to": [{"address": to_email}]},
            "content": {"subject": subject, "html": html_body, "plainText": plain_body},
        }
        poller = client.begin_send(message)
        result = poller.result()
        msg_id = getattr(result, "message_id", None) or "unknown"
        log.info("Auth-failed facility email sent to %s for %s (message_id=%s)", to_email, facility_code, msg_id)
        return True
    except Exception:
        log.exception("Failed to send auth-failed facility email to %s for %s", to_email, facility_code)
        return False


def send_auth_failed_reseller_email(
    to_email: str,
    reseller_name: str,
    facility_code: str,
    facility_name: str,
    auth_failed_time: str,
) -> bool:
    """
    Notify reseller (Saleem) that a facility's auth failed and the client has been notified.
    Returns True on success, False on failure (never raises).
    """
    if not ACS_CONNECTION_STRING or not ACS_SENDER_ADDRESS:
        log.warning("ACS not configured — skipping auth-failed reseller email to %s", to_email)
        return False

    subject = f"Alert — {facility_code} auth failed, client notified"
    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F4F4F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F5;padding:40px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <tr><td style="background:#92400E;padding:32px 40px;text-align:center;">
    <h1 style="margin:0;color:#FFFFFF;font-size:22px;font-weight:700;">ClaimSync — Auth Alert</h1>
    <p style="margin:8px 0 0;color:#FCD34D;font-size:13px;">Operator Notification</p>
  </td></tr>
  <tr><td style="padding:32px 40px;">
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi {reseller_name},</p>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px;">
      <strong>{facility_code} — {facility_name}</strong> failed Shafafiya authentication
      at <strong>{auth_failed_time}</strong>.
    </p>
    <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:24px;">
    <tr><td style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:16px 20px;">
      <p style="margin:0 0 8px;color:#92400E;font-size:13px;font-weight:600;">What happened</p>
      <ul style="margin:0;padding-left:20px;color:#78350F;font-size:13px;line-height:1.7;">
        <li>The facility's Shafafiya password may have been changed</li>
        <li>The client has been sent a credential update link via email</li>
        <li>Scheduled syncs for this facility are paused until credentials are updated</li>
      </ul>
    </td></tr>
    </table>
    <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 8px;">
      You can also trigger a manual credential update from the admin dashboard under
      Facilities → {facility_code} → Resend Update Link.
    </p>
  </td></tr>
  <tr><td style="background:#F9FAFB;padding:20px 40px;text-align:center;border-top:1px solid #E5E7EB;">
    <p style="color:#9CA3AF;font-size:11px;margin:0;">ClaimSync by Kaaryaa Intelligence LLP &bull; Abu Dhabi, UAE</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""

    plain_body = f"""ClaimSync — Auth Alert: {facility_code}
{'=' * 50}

Hi {reseller_name},

{facility_code} — {facility_name} failed Shafafiya authentication at {auth_failed_time}.

The facility has been sent a credential update link via email. Scheduled syncs are paused until credentials are updated.

You can also trigger a manual update from the admin dashboard under Facilities → {facility_code} → Resend Update Link.

---
ClaimSync by Kaaryaa Intelligence LLP | Abu Dhabi, UAE
"""

    try:
        from azure.communication.email import EmailClient
        client = EmailClient.from_connection_string(ACS_CONNECTION_STRING)
        message = {
            "senderAddress": ACS_SENDER_ADDRESS,
            "recipients": {"to": [{"address": to_email}]},
            "content": {"subject": subject, "html": html_body, "plainText": plain_body},
        }
        poller = client.begin_send(message)
        result = poller.result()
        msg_id = getattr(result, "message_id", None) or "unknown"
        log.info("Auth-failed reseller email sent to %s for %s (message_id=%s)", to_email, facility_code, msg_id)
        return True
    except Exception:
        log.exception("Failed to send auth-failed reseller email to %s for %s", to_email, facility_code)
        return False
