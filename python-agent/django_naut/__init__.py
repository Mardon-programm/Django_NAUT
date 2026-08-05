"""DjangoNAUT agent: SQL telemetry, error interceptor, notebook shell.

Install into a Django project:

    pip install -e ./python-agent      # from this repo
    # then add "django_naut" to INSTALLED_APPS
"""

__version__ = "1.0.0"
default_app_config = "django_naut.apps.DjangoNautConfig"
