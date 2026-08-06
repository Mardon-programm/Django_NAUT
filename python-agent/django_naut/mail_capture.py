"""Mail Capture backend: writes every outgoing email as a JSON file.

Enabled automatically when `python -m django_naut runserver` is started
with DJANGO_NAUT_MAIL_CAPTURE=1 (the IDE sets this). Emails land in the
directory from DJANGO_NAUT_MAIL_FILE as <id>.json so the IDE's Mail
Inspector can list, preview and clear them.
"""

import datetime
import json
import os
import uuid

from django.core.mail.backends.base import BaseEmailBackend


def mail_dir():
    return os.environ.get("DJANGO_NAUT_MAIL_FILE") or os.path.join(
        os.getcwd(), "django_naut_mail"
    )


class EmailBackend(BaseEmailBackend):
    def send_messages(self, email_messages):
        count = 0
        for message in email_messages:
            try:
                self._capture(message)
                count += 1
            except Exception:
                if not self.fail_silently:
                    raise
        return count

    def _capture(self, message):
        attachments = []
        for name, content, content_type in message.attachments:
            if isinstance(content, str):
                content = content.encode("utf-8")
            attachments.append(
                {
                    "name": name or "file",
                    "type": content_type or "",
                    "size": len(content),
                }
            )
        html = None
        for alt in message.alternatives:
            content, ctype = alt[0], alt[1]
            if ctype == "text/html":
                html = content
        payload = {
            "id": message.extra_headers.get("X-DjangoNAUT-Id") or str(uuid.uuid4()),
            "subject": message.subject or "(no subject)",
            "from": message.from_email,
            "to": list(message.to),
            "cc": list(message.cc),
            "bcc": list(message.bcc),
            "reply_to": list(message.reply_to),
            "date": datetime.datetime.now().isoformat(timespec="seconds"),
            "text": message.body,
            "html": html,
            "attachments": attachments,
            "headers": {
                k: v for k, v in (message.extra_headers or {}).items() if k != "X-DjangoNAUT-Id"
            },
        }
        out_dir = mail_dir()
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, payload["id"] + ".json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
