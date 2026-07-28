"""
WebSocket consumer for the interactive terminal.

This consumer spawns a real OS shell (bash/sh/cmd) and bridges
stdin/stdout/stderr between the shell process and the xterm.js frontend
via WebSocket messages.

Protocol (JSON messages):
  Client -> Server:
    {"type": "input",  "data": "<keystrokes>"}   -- send input to shell
    {"type": "resize", "cols": N, "rows": N}     -- resize the pty
    {"type": "ping"}                              -- keepalive

  Server -> Client:
    {"type": "output", "data": "<shell output>"}  -- stdout/stderr from shell
    {"type": "exit",   "code": N}                 -- shell process exited
    {"type": "error",  "message": "<error>"}      -- error message
    {"type": "pong"}                              -- keepalive response
"""

import os
import json
import platform
import asyncio
import logging
from channels.generic.websocket import AsyncWebsocketConsumer

logger = logging.getLogger(__name__)

# ── Shell detection ──────────────────────────────────────────────────────────


def get_shell():
    """Detect the appropriate shell for the current OS."""
    system = platform.system()
    if system == "Windows":
        # Prefer PowerShell on Windows, fallback to cmd
        powershell = "powershell.exe"
        for p in [powershell, "cmd.exe"]:
            if os.path.exists(p) or any(
                os.path.exists(os.path.join(d, p))
                for d in os.environ.get("PATH", "").split(os.pathsep)
            ):
                return p
        return "cmd.exe"
    else:
        # Unix: prefer bash, fallback to sh
        return os.environ.get("SHELL", "/bin/bash")


class TerminalConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer that spawns a persistent shell process.

    Each WebSocket connection gets its own shell instance.
    Input from the browser is written to the shell's stdin.
    Output from the shell's stdout/stderr is sent back to the browser.
    """

    async def connect(self):
        """Accept WebSocket connection and spawn a shell process."""
        await self.accept()

        # Determine working directory from query string or default
        workspace = self.scope.get("query_string", b"").decode()
        if workspace.startswith("workspace="):
            from urllib.parse import unquote

            cwd = unquote(workspace.split("=", 1)[1])
            if not os.path.isdir(cwd):
                cwd = os.path.expanduser("~")
        else:
            cwd = os.path.expanduser("~")

        # Shell configuration
        shell = get_shell()
        env = os.environ.copy()
        env.update(
            {
                "TERM": "xterm-256color",
                "FORCE_COLOR": "1",
                "PYTHONIOENCODING": "utf-8",
                "COLORTERM": "truecolor",
            }
        )

        try:
            # Create the shell subprocess
            if "powershell" in shell.lower():
                self.process = await asyncio.create_subprocess_exec(
                    shell,
                    "-NoLogo",
                    "-NoProfile",
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=cwd,
                    env=env,
                )
                # Send PowerShell init commands for proper encoding
                init_cmd = (
                    "$OutputEncoding = [System.Text.Encoding]::UTF8; "
                    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
                    'try { $PSStyle.OutputRendering = "PlainText" } catch {};\r\n'
                )
                self.process.stdin.write(init_cmd.encode("utf-8"))
                await self.process.stdin.drain()
            elif "cmd" in shell.lower():
                # Force UTF-8 code page for cmd.exe
                self.process = await asyncio.create_subprocess_exec(
                    shell,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=cwd,
                    env=env,
                )
                self.process.stdin.write(b"chcp 65001 >nul 2>&1\r\n")
                await self.process.stdin.drain()
            else:
                # bash / sh on Linux/Mac
                self.process = await asyncio.create_subprocess_exec(
                    shell,
                    "--norc",
                    "--noprofile",
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=cwd,
                    env=env,
                )

            # Start reading stdout and stderr in background tasks
            self._stdout_task = asyncio.create_task(
                self._read_stream(self.process.stdout)
            )
            self._stderr_task = asyncio.create_task(
                self._read_stream(self.process.stderr)
            )

        except Exception as e:
            logger.error("Failed to spawn shell: %s", e)
            await self.send(
                json.dumps(
                    {
                        "type": "error",
                        "message": f"Failed to start shell: {e}",
                    }
                )
            )
            await self.close()

    async def disconnect(self, close_code):
        """Clean up the shell process when WebSocket closes."""
        # Cancel reader tasks
        for task in [
            getattr(self, "_stdout_task", None),
            getattr(self, "_stderr_task", None),
        ]:
            if task and not task.done():
                task.cancel()

        # Kill the shell process
        if hasattr(self, "process") and self.process:
            try:
                self.process.terminate()
                await asyncio.wait_for(self.process.wait(), timeout=3.0)
            except (ProcessLookupError, asyncio.TimeoutError):
                try:
                    self.process.kill()
                except ProcessLookupError:
                    pass
            except Exception:
                pass

    async def receive(self, text_data):
        """Handle incoming messages from the browser (xterm.js)."""
        try:
            message = json.loads(text_data)
        except json.JSONDecodeError:
            return

        msg_type = message.get("type", "")

        if msg_type == "input":
            # Forward user keystrokes to shell stdin
            data = message.get("data", "")
            if (
                self.process
                and self.process.stdin
                and not self.process.stdin.is_closing()
            ):
                try:
                    self.process.stdin.write(data.encode("utf-8"))
                    await self.process.stdin.drain()
                except (BrokenPipeError, OSError):
                    pass

        elif msg_type == "resize":
            # Resize the terminal (we store it for reference;
            # actual PTY resize requires pty module or winpty)
            self._cols = message.get("cols", 80)
            self._rows = message.get("rows", 24)

        elif msg_type == "ping":
            await self.send(json.dumps({"type": "pong"}))

    async def _read_stream(self, stream):
        """Read from a subprocess stream and send output to the WebSocket."""
        try:
            while True:
                data = await stream.read(4096)
                if not data:
                    break
                await self.send(
                    json.dumps(
                        {
                            "type": "output",
                            "data": data.decode("utf-8", errors="replace"),
                        }
                    )
                )
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.debug("Stream read error: %s", e)

        # If we get here, the stream closed (shell exited)
        if stream == getattr(self.process, "stdout", None):
            exit_code = self.process.returncode or 0
            await self.send(
                json.dumps(
                    {
                        "type": "exit",
                        "code": exit_code,
                    }
                )
            )
