"""
WebSocket URL routing for the editor app.

Maps WebSocket connections to their consumers.
"""

from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r"ws/terminal/$", consumers.TerminalConsumer.as_asgi()),
]
