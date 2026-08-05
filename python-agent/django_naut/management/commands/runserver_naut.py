"""`python manage.py runserver_naut [--naut-port PORT]` — runserver with
DjangoNAUT SQL telemetry and error interception.

Usage (from the Django project root):
    python manage.py runserver_naut

The middleware is injected at runtime, no settings.py edits required.
Point DJANGONAUT_PORT at the IDE listener (set automatically by the IDE
when it spawns this command).
"""

import os

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Run Django dev server with DjangoNAUT SQL telemetry & error interceptor"

    def add_arguments(self, parser):
        parser.add_argument("--naut-port", type=int, default=0)
        parser.add_argument("--naut-host", type=str, default="127.0.0.1")
        parser.add_argument("args", nargs="*", type=str)

    def handle(self, *args, **options):
        port = options.get("naut_port") or int(os.environ.get("DJANGONAUT_PORT") or 0)
        host = options.get("naut_host") or os.environ.get("DJANGONAUT_HOST") or "127.0.0.1"
        if port:
            settings.DJANGONAUT_PORT = port
            settings.DJANGONAUT_HOST = host
        settings.DJANGONAUT_PROJECT = os.getcwd()

        middleware_name = "django_naut.middleware.DjangoNautMiddleware"
        if middleware_name not in settings.MIDDLEWARE:
            settings.MIDDLEWARE = [middleware_name] + list(settings.MIDDLEWARE)

        self.stdout.write(
            self.style.SUCCESS("[django_naut] telemetry on port %s" % (port or "disabled"))
        )

        argv = list(options.get("args") or [])
        if argv:
            addr, port_part = argv[0], argv[1] if len(argv) > 1 else None
        else:
            addr, port_part = None, None
        runserver_args = ["runserver"]
        if addr:
            runserver_args.append(addr)
        if port_part:
            runserver_args.append(port_part)
        call_command(*runserver_args)
