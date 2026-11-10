"""Launch the repository game-log writer from the designated Mac user session."""

import argparse
import fcntl
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import sys


KEYCHAIN_SERVICE = "com.betstreaks.refresh.supabase"


def read_project_url(config_dir: Path) -> str:
    directory = config_dir.lstat()
    if not stat.S_ISDIR(directory.st_mode) or directory.st_uid != os.getuid() or directory.st_mode & 0o077:
        raise ValueError("The refresh configuration directory must be private and owned by the LaunchAgent user")
    config = config_dir / "project-url"
    info = config.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("The project-url file must be private and owned by the LaunchAgent user")
    url = config.read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"https://[a-z0-9-]+[.]supabase[.]co", url):
        raise ValueError("The refresh project URL must be the configured Supabase HTTPS origin")
    return url


def read_keychain_key() -> str:
    try:
        result = subprocess.run(
            [
                "/usr/bin/security", "find-generic-password", "-w",
                "-s", KEYCHAIN_SERVICE, "-a", pwd.getpwuid(os.getuid()).pw_name,
                str(Path.home() / "Library/Keychains/login.keychain-db"),
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=10,
            check=True,
            text=True,
        )
        key = result.stdout.strip()
    except (OSError, subprocess.SubprocessError, UnicodeError):
        key = ""
    if not re.fullmatch(r"sb_secret_[A-Za-z0-9_-]+", key):
        raise ValueError("A modern NBA refresh key is required in the LaunchAgent user's login Keychain")
    return key


def launch(config_dir: Path, check_config: bool) -> int:
    if sys.version_info < (3, 11):
        print("NBA refresh requires Python 3.11 or newer.", file=sys.stderr)
        return 1

    try:
        url = read_project_url(config_dir)
        lock_fd = os.open(config_dir / "nba-refresh.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(lock_fd, "w") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print("NBA refresh already running on this Mac.", file=sys.stderr)
                return 1

            key = read_keychain_key()
            from refresh import main as refresh

            if check_config:
                print("NBA refresh configuration and Python imports are ready.")
                return 0

            os.environ["SUPABASE_URL"] = url
            os.environ["SUPABASE_REFRESH_API_KEY"] = key
            refresh(game_logs_only=True)
            return 0
    except (OSError, ValueError, ImportError):
        # Exceptions can include configuration, Keychain stdout or provider details.
        print("NBA refresh failed. Check the private config, Keychain and virtual environment.", file=sys.stderr)
    except Exception:
        print("NBA refresh failed during execution.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-config", action="store_true", help="Check local setup without contacting services")
    args = parser.parse_args()
    sys.exit(launch(Path.home() / ".config/betstreaks", args.check_config))
