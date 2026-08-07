import os
from pathlib import Path

# ── Base directory ───────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent

# ── Security ─────────────────────────────────────────────────────────────────
SECRET_KEY = "django-insecure-web-editor-dev-key-change-in-production"
DEBUG = True
ALLOWED_HOSTS = ["*"]

# ── Installed apps ───────────────────────────────────────────────────────────
INSTALLED_APPS = [
    "daphne",  # ASGI server (must be first for Channels)
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "channels",  # Django Channels for WebSocket support
    "editor",  # Our editor app
    "django_naut",  # DjangoNAUT agent (SQL telemetry + error interceptor)
]

# ── Middleware ────────────────────────────────────────────────────────────────
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# ── Database (SQLite for development) ───────────────────────────────────────
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

# ── Channel Layers (In-memory for dev, Redis for production) ────────────────
# For development, use InMemoryChannelLayer (no Redis needed)
# For production, switch to Redis:
#   CHANNEL_LAYERS = {
#       'default': {
#           'BACKEND': 'channels_redis.core.RedisChannelLayer',
#           'CONFIG': {'hosts': [('127.0.0.1', 6379)]},
#       },
#   }
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    },
}

# ── Password validation ─────────────────────────────────────────────────────
AUTH_PASSWORD_VALIDATORS = []

# ── Internationalization ─────────────────────────────────────────────────────
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# ── Static files ─────────────────────────────────────────────────────────────
STATIC_URL = "/static/"
STATICFILES_DIRS = [
    BASE_DIR / "static",
]

# ── Default primary key ─────────────────────────────────────────────────────
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ── Terminal working directory ───────────────────────────────────────────────
# This is the root directory the terminal will start in.
# Change this to your project root or leave as HOME.
TERMINAL_WORKSPACE = os.path.expanduser("~")

# ── GROQ API (for AI test generation) ──────────────────────────────────────
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.3-70b-versatile"
