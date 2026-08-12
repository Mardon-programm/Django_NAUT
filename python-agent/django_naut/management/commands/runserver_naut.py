"""`python -m django_naut runserver [--naut-port PORT] [addr:port]` — runserver
with DjangoNAUT SQL telemetry and error interception.

Also available as a manage.py command (`python manage.py runserver_naut`) when
django_naut is installed as an app.

The middleware is injected at runtime, no settings.py edits required.
Point DJANGONAUT_PORT at the IDE listener (set automatically by the IDE
when it spawns this command).
"""

import os

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand

_MIDDLEWARE = "django_naut.middleware.DjangoNautMiddleware"


def _start(port, host, args):
    if port:
        settings.DJANGONAUT_PORT = port
        settings.DJANGONAUT_HOST = host
    settings.DJANGONAUT_PROJECT = os.getcwd()

    if _MIDDLEWARE not in settings.MIDDLEWARE:
        settings.MIDDLEWARE = [_MIDDLEWARE] + list(settings.MIDDLEWARE)

    call_command("runserver", *args)


def run(argv):
    """Entry point for `python -m django_naut runserver [...]`."""
    port = int(os.environ.get("DJANGONAUT_PORT") or 0)
    host = os.environ.get("DJANGONAUT_HOST") or "127.0.0.1"
    rest = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--naut-port" and i + 1 < len(argv):
            port = int(argv[i + 1])
            i += 2
            continue
        if a == "--naut-host" and i + 1 < len(argv):
            host = argv[i + 1]
            i += 2
            continue
        rest.append(a)
        i += 1
    _start(port, host, rest)


class Command(BaseCommand):
    help = "Run Django dev server with DjangoNAUT SQL telemetry & error interceptor"

    def add_arguments(self, parser):
        parser.add_argument("--naut-port", type=int, default=0)
        parser.add_argument("--naut-host", type=str, default="127.0.0.1")
        parser.add_argument("args", nargs="*", type=str)

    def handle(self, *args, **options):
        port = options.get("naut_port") or int(os.environ.get("DJANGONAUT_PORT") or 0)
        host = options.get("naut_host") or os.environ.get("DJANGONAUT_HOST") or "127.0.0.1"
        self.stdout.write(
            self.style.SUCCESS("[django_naut] telemetry on port %s" % (port or "disabled"))
        )
        _start(port, host, list(args or []))
