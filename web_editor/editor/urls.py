"""
URL patterns for the editor app.
"""

from django.urls import path
from . import views

urlpatterns = [
    # Main editor page
    path("", views.editor_view, name="editor"),
    # File operation API endpoints
    path("api/read/", views.api_read_file, name="api_read_file"),
    path("api/write/", views.api_write_file, name="api_write_file"),
    path("api/list/", views.api_list_dir, name="api_list_dir"),
    path("api/delete/", views.api_delete, name="api_delete"),
    path("api/rename/", views.api_rename, name="api_rename"),
    path("api/create-file/", views.api_create_file, name="api_create_file"),
    path("api/create-dir/", views.api_create_dir, name="api_create_dir"),
    path("api/search/", views.api_search, name="api_search"),
    # AI endpoints
    path(
        "api/ai/generate-tests/",
        views.api_ai_generate_tests,
        name="api_ai_generate_tests",
    ),
    # Docker endpoints
    path("api/docker/logs/", views.api_docker_logs, name="api_docker_logs"),
    path("api/docker/status/", views.api_docker_status, name="api_docker_status"),
    # HTTP Client proxy
    path("api/http/proxy/", views.api_http_proxy, name="api_http_proxy"),
]
