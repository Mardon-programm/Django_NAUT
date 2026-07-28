"""
ASGI config for web_editor project.

Configures Django Channels to handle both HTTP and WebSocket protocols.
"""

import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

django_asgi_app = get_asgi_application()

# Import routing after Django setup
from editor.routing import websocket_urlpatterns

application = ProtocolTypeRouter(
    {
        # HTTP requests handled by Django
        "http": django_asgi_app,
        # WebSocket requests handled by Channels consumers
        "websocket": AuthMiddlewareStack(URLRouter(websocket_urlpatterns)),
    }
)
