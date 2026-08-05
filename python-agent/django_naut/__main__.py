"""`python -m django_naut` — standalone JSON-RPC shell (no INSTALLED_APPS edit).

Requires DJANGO_SETTINGS_MODULE and PYTHONPATH pointing at the Django
project (the IDE sets these automatically).
"""

from django_naut.management.commands.shell_naut import main

if __name__ == "__main__":
    main()
