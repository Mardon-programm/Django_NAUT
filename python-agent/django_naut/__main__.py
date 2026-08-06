"""`python -m django_naut` — standalone entry point, no INSTALLED_APPS edit needed.

Subcommands:
  (default)                    JSON-RPC shell over stdio (notebook / inspection)
  runserver [--naut-port PORT] runserver with SQL telemetry + error interceptor

Requires DJANGO_SETTINGS_MODULE and PYTHONPATH pointing at the Django
project (the IDE sets these automatically; otherwise settings.py is
auto-discovered by walking up from the current directory).
"""

import os
import pathlib
import sys


def _auto_settings():
    if os.environ.get("DJANGO_SETTINGS_MODULE"):
        return
    candidates = [pathlib.Path.cwd()] + list(pathlib.Path.cwd().parents[:4])
    for base in candidates:
        settings_py = base / "settings.py"
        if settings_py.is_file():
            os.environ["DJANGO_SETTINGS_MODULE"] = base.name + ".settings"
            sys.path.insert(0, str(base.parent))
            return
        for sub in base.iterdir():
            settings_py = sub / "settings.py"
            if settings_py.is_file() and (sub / "__init__.py").is_file():
                os.environ["DJANGO_SETTINGS_MODULE"] = sub.name + ".settings"
                sys.path.insert(0, str(base))
                return
    raise SystemExit(
        "[django_naut] DJANGO_SETTINGS_MODULE is not set and no settings.py "
        "was found near the current directory."
    )


def main():
    args = sys.argv[1:]
    if args and args[0] == "runserver":
        _auto_settings()
        import django

        django.setup()
        if os.environ.get("DJANGO_NAUT_MAIL_CAPTURE"):
            from django.conf import settings

            if hasattr(settings, "MAILERS"):
                mailers = settings.MAILERS
                if isinstance(mailers, dict) and isinstance(
                    mailers.get("default"), dict
                ):
                    mailers["default"]["BACKEND"] = (
                        "django_naut.mail_capture.EmailBackend"
                    )
                else:
                    settings.MAILERS = {
                        "default": {
                            "BACKEND": "django_naut.mail_capture.EmailBackend"
                        }
                    }
            else:
                settings.EMAIL_BACKEND = "django_naut.mail_capture.EmailBackend"
        from django_naut.management.commands.runserver_naut import run

        run(args[1:])
    else:
        from django_naut.management.commands.shell_naut import main as shell_main

        shell_main()


if __name__ == "__main__":
    main()
